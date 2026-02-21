import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon, PlusIcon, XIcon, FileTextIcon, FileCodeIcon, FileIcon, ImageIcon } from "lucide-react";
import { useClaudeChatStore, offsetToLineCol } from "@/stores/claude-chat-store";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

interface PinnedContext {
  label: string;       // @file:line:col-line:col
  filePath: string;
  selectedText: string;
}

function getFileIcon(file: ProjectFile) {
  if (file.type === "image") return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (file.type === "style") return <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  if (file.type === "other") return <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  return <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

export const ChatComposer: FC = () => {
  const sendPrompt = useClaudeChatStore((s) => s.sendPrompt);
  const cancelExecution = useClaudeChatStore((s) => s.cancelExecution);
  const newSession = useClaudeChatStore((s) => s.newSession);
  const isStreaming = useClaudeChatStore((s) => s.isStreaming);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pinned context — persists after selection clears and after send
  const [pinnedContext, setPinnedContext] = useState<PinnedContext | null>(null);

  // @ mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionFiles, setMentionFiles] = useState<ProjectFile[]>([]);
  const mentionRef = useRef<HTMLDivElement>(null);

  // Watch selection changes to auto-pin context
  const selectionRange = useDocumentStore((s) => s.selectionRange);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);

  const currentContextLabel = useMemo(() => {
    if (!selectionRange) return null;
    const file = files.find((f) => f.id === activeFileId);
    if (!file?.content) return null;
    const start = offsetToLineCol(file.content, selectionRange.start);
    const end = offsetToLineCol(file.content, selectionRange.end);
    return `@${file.relativePath}:${start.line}:${start.col}-${end.line}:${end.col}`;
  }, [selectionRange, activeFileId, files]);

  // Auto-pin when a new selection is made
  useEffect(() => {
    if (!selectionRange || !currentContextLabel) return;
    const file = files.find((f) => f.id === activeFileId);
    if (!file?.content) return;
    setPinnedContext({
      label: currentContextLabel,
      filePath: file.relativePath,
      selectedText: file.content.slice(selectionRange.start, selectionRange.end),
    });
  }, [selectionRange, currentContextLabel, activeFileId, files]);

  // Compute @ mention matches
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionFiles([]);
      return;
    }
    const q = mentionQuery.toLowerCase();
    const matched = files
      .filter((f) => f.type !== "image")
      .filter((f) => f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 8);
    setMentionFiles(matched);
    setMentionIndex(0);
  }, [mentionQuery, files]);

  const selectMention = useCallback((file: ProjectFile) => {
    // Replace @query with empty and pin the file as context
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    // Find the @ position before cursor
    const textBefore = input.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex === -1) return;
    const newInput = input.slice(0, atIndex) + input.slice(cursorPos);
    setInput(newInput);
    setMentionQuery(null);

    // Pin the whole file as context
    setPinnedContext({
      label: `@${file.relativePath}`,
      filePath: file.relativePath,
      selectedText: file.content ?? "",
    });

    // Refocus textarea
    setTimeout(() => textarea.focus(), 0);
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    setMentionQuery(null);
    // Send with pinned context override so it works even if selection was cleared
    if (pinnedContext) {
      sendPrompt(trimmed, pinnedContext);
    } else {
      sendPrompt(trimmed);
    }
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // Clear pinned context after send — it's now part of the chat message
    setPinnedContext(null);
  }, [input, isStreaming, sendPrompt, pinnedContext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @ mention navigation
      if (mentionQuery !== null && mentionFiles.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionFiles.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectMention(mentionFiles[mentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Backspace at start of empty input removes pinned context
      if (e.key === "Backspace" && pinnedContext && input === "") {
        e.preventDefault();
        setPinnedContext(null);
      }
    },
    [handleSend, pinnedContext, input, mentionQuery, mentionFiles, mentionIndex, selectMention],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);

      // Detect @ mention trigger
      const cursorPos = e.target.selectionStart;
      const textBefore = value.slice(0, cursorPos);
      // Match @ at start of input or after a space
      const atMatch = textBefore.match(/(?:^|[\s])@([^\s]*)$/);
      if (atMatch) {
        setMentionQuery(atMatch[1]);
      } else {
        setMentionQuery(null);
      }

      // Auto-resize
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    },
    [],
  );

  // Scroll active mention into view
  useEffect(() => {
    if (mentionRef.current) {
      const active = mentionRef.current.querySelector("[data-active=true]");
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex]);

  return (
    <div className="relative shrink-0 p-3">
      {/* @ mention dropdown */}
      {mentionQuery !== null && mentionFiles.length > 0 && (
        <div
          ref={mentionRef}
          className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        >
          {mentionFiles.map((file, i) => {
            const parts = file.relativePath.split("/");
            const fileName = parts.pop()!;
            const dirPath = parts.length > 0 ? parts.join("/") + "/" : "";
            return (
              <button
                key={file.id}
                data-active={i === mentionIndex}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                  i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent textarea blur
                  selectMention(file);
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                {getFileIcon(file)}
                <span className="truncate font-mono text-sm">{fileName}</span>
                {dirPath && (
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{dirPath}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex w-full flex-col rounded-2xl border border-input bg-muted/30 transition-colors focus-within:border-ring focus-within:bg-background">
        {/* Pinned context chip + textarea in one flow */}
        <div className="flex flex-wrap items-center gap-1 px-4 pt-3 pb-0">
          {pinnedContext && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {pinnedContext.label}
              <button
                onClick={() => setPinnedContext(null)}
                className="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-muted-foreground/20"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask about LaTeX..."
          className="max-h-40 min-h-10 w-full resize-none bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
          rows={1}
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <TooltipIconButton
            tooltip="New conversation"
            side="top"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            onClick={newSession}
          >
            <PlusIcon className="size-4" />
          </TooltipIconButton>

          <div>
            {isStreaming ? (
              <TooltipIconButton
                tooltip="Stop"
                side="top"
                variant="secondary"
                size="icon"
                className="size-8 rounded-full"
                onClick={cancelExecution}
              >
                <SquareIcon className="size-3 fill-current" />
              </TooltipIconButton>
            ) : (
              <TooltipIconButton
                tooltip="Send"
                side="top"
                variant="default"
                size="icon"
                className="size-8 rounded-full"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                <ArrowUpIcon className="size-4" />
              </TooltipIconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
