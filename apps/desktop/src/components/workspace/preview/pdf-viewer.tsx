import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { LoaderIcon } from "lucide-react";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfViewerProps {
  data: Uint8Array;
  scale: number;
  onError?: (error: string) => void;
  onLoadSuccess?: (numPages: number) => void;
  onScaleChange?: (scale: number) => void;
  onTextClick?: (text: string) => void;
  onSynctexClick?: (page: number, x: number, y: number) => void;
}

export function PdfViewer({
  data,
  scale,
  onError,
  onLoadSuccess,
  onScaleChange,
  onTextClick,
  onSynctexClick,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasSetInitialScale = useRef(false);
  const [numPages, setNumPages] = useState(0);

  // Keep refs for values used in native event listeners
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const synctexClickRef = useRef(onSynctexClick);
  synctexClickRef.current = onSynctexClick;

  // Scroll preservation across recompile
  const isFirstLoad = useRef(true);
  const savedPageRef = useRef<number>(0); // 0 = no saved page

  /** Compute which page is currently at the top of the viewport */
  function getVisiblePage(): number {
    const container = containerRef.current;
    if (!container) return 1;
    const pages = container.querySelectorAll(".react-pdf__Page");
    if (pages.length === 0) return 1;
    const containerRect = container.getBoundingClientRect();
    for (const page of pages) {
      const el = page as HTMLElement;
      const rect = el.getBoundingClientRect();
      // First page whose bottom is past the container top (+50px threshold)
      if (rect.bottom > containerRect.top + 50) {
        return parseInt(el.getAttribute("data-page-number") || "1", 10);
      }
    }
    return 1;
  }

  const file = useMemo(() => {
    const pdfData =
      data instanceof Uint8Array ? data : new Uint8Array(Object.values(data));
    // Only reset initial scale on first load, not on recompile
    if (isFirstLoad.current) {
      hasSetInitialScale.current = false;
    }
    // Save visible page and lock container height before Document reloads
    if (containerRef.current && !isFirstLoad.current) {
      const page = getVisiblePage();
      savedPageRef.current = page;
      // Lock the inner content div height to prevent scroll collapse
      // when Document unmounts Page children during loading
      if (contentRef.current) {
        contentRef.current.style.minHeight = `${contentRef.current.scrollHeight}px`;
      }
      console.log("[pdf-viewer] data changed → saved page:", page, "locked minHeight:", contentRef.current?.scrollHeight);
    }
    return { data: pdfData.slice() };
  }, [data]);

  const handleLoadSuccess = useCallback(
    ({ numPages: newNumPages }: { numPages: number }) => {
      setNumPages(newNumPages);
      isFirstLoad.current = false;
      onLoadSuccess?.(newNumPages);

      const targetPage = savedPageRef.current;
      console.log("[pdf-viewer] Document loaded, numPages:", newNumPages, "targetPage:", targetPage);

      if (targetPage > 0) {
        savedPageRef.current = 0;
        // Poll until the target page element renders with height
        const scrollToPage = (attempts: number) => {
          const container = containerRef.current;
          if (!container || attempts <= 0) {
            console.log("[pdf-viewer] scroll restore gave up after max attempts");
            // Clear min-height even if we fail
            if (contentRef.current) contentRef.current.style.minHeight = "";
            return;
          }
          const pageEl = container.querySelector(
            `[data-page-number="${targetPage}"]`,
          ) as HTMLElement | null;
          console.log("[pdf-viewer] scrollToPage attempt", 30 - attempts + 1, "pageEl:", !!pageEl, "height:", pageEl?.clientHeight);
          if (pageEl && pageEl.clientHeight > 0) {
            const containerRect = container.getBoundingClientRect();
            const pageRect = pageEl.getBoundingClientRect();
            container.scrollTop += pageRect.top - containerRect.top - 16; // 16px for padding
            console.log("[pdf-viewer] scrolled to page", targetPage, "scrollTop:", container.scrollTop);
            // Clear min-height
            if (contentRef.current) contentRef.current.style.minHeight = "";
          } else {
            requestAnimationFrame(() => scrollToPage(attempts - 1));
          }
        };
        requestAnimationFrame(() => scrollToPage(30)); // ~30 frames = ~500ms
      }
    },
    [onLoadSuccess],
  );

  const handlePageLoadSuccess = useCallback(
    ({ width }: { width: number }) => {
      if (hasSetInitialScale.current) return;
      if (containerRef.current && onScaleChange) {
        hasSetInitialScale.current = true;
        const containerWidth = containerRef.current.clientWidth - 32;
        const fitScale = containerWidth / width;
        onScaleChange(Math.min(fitScale, 2));
      }
    },
    [onScaleChange],
  );

  const handleLoadError = useCallback(
    (error: Error) => {
      onError?.(error.message);
    },
    [onError],
  );

  const handleTextLayerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onTextClick) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === "SPAN" &&
        target.closest(".react-pdf__Page__textContent")
      ) {
        const text = target.textContent?.trim();
        if (text && text.length > 2) {
          onTextClick(text);
        }
      }
    },
    [onTextClick],
  );

  // Native dblclick listener — more reliable than React's onDoubleClick
  // because it captures events from react-pdf's text layer properly
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDblClick = (e: MouseEvent) => {
      const cb = synctexClickRef.current;
      if (!cb) return;

      const target = e.target as HTMLElement;
      const pageEl = target.closest(".react-pdf__Page") as HTMLElement | null;
      if (!pageEl) {
        console.log("[synctex] dblclick: no .react-pdf__Page found");
        return;
      }

      const pageNum = parseInt(pageEl.getAttribute("data-page-number") || "0", 10);
      if (pageNum === 0) {
        console.log("[synctex] dblclick: no data-page-number attribute");
        return;
      }

      // Get click position relative to the page element
      const rect = pageEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      // Convert screen pixels → PDF points (72 DPI)
      // Both canvas and synctex use top-left origin, y-down
      const currentScale = scaleRef.current;
      const pdfX = offsetX / currentScale;
      const pdfY = offsetY / currentScale;

      console.log("[synctex] dblclick:", { pageNum, pdfX: pdfX.toFixed(1), pdfY: pdfY.toFixed(1), scale: currentScale });
      cb(pageNum, pdfX, pdfY);
    };

    container.addEventListener("dblclick", handleDblClick);
    return () => container.removeEventListener("dblclick", handleDblClick);
  }, []); // stable — uses refs for changing values

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScaleChange) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.001;
        onScaleChange(Math.max(0.25, Math.min(4, scale + delta)));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scale, onScaleChange]);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <div
        ref={contentRef}
        className="flex flex-col items-center gap-4 p-4"
        onClick={handleTextLayerClick}
      >
        <Document
          file={file}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          loading={
            numPages > 0 ? (
              // During recompile, show nothing so old pages remain visible
              <></>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LoaderIcon className="size-4 animate-spin" />
                Loading PDF...
              </div>
            )
          }
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i + 1}
              pageNumber={i + 1}
              scale={scale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="mb-4 shadow-lg"
              onLoadSuccess={i === 0 ? handlePageLoadSuccess : undefined}
            />
          ))}
        </Document>
      </div>
    </div>
  );
}
