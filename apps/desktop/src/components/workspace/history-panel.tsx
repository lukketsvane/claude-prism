import { useEffect, useRef, useState, useCallback } from "react";
import {
  HistoryIcon,
  LoaderIcon,
  TagIcon,
  RotateCcwIcon,
  CopyIcon,
  PlusIcon,
  XIcon,
  FileTextIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useHistoryStore, type SnapshotInfo, type FileDiff } from "@/stores/history-store";
import { useDocumentStore } from "@/stores/document-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// ─── Helpers ───

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function snapshotTypeLabel(message: string): string {
  if (message.startsWith("[auto]")) return "Auto-save";
  if (message.startsWith("[manual]")) return "Save";
  if (message.startsWith("[compile]")) return "Compile";
  if (message.startsWith("[claude]")) return message.includes("Before") ? "Before Claude" : "After Claude";
  if (message.startsWith("[restore]")) return "Restore";
  if (message.startsWith("[init]")) return "Initial";
  return message;
}

function snapshotTypeBadgeColor(message: string): string {
  if (message.startsWith("[claude]")) return "bg-violet-500/15 text-violet-600 dark:text-violet-400";
  if (message.startsWith("[restore]")) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (message.startsWith("[manual]")) return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  if (message.startsWith("[compile]")) return "bg-green-500/15 text-green-600 dark:text-green-400";
  return "bg-muted text-muted-foreground";
}

function diffStatusColor(status: string): string {
  if (status === "added") return "text-green-600 dark:text-green-400";
  if (status === "deleted") return "text-red-600 dark:text-red-400";
  return "text-blue-600 dark:text-blue-400";
}

function diffStatusPrefix(status: string): string {
  if (status === "added") return "+";
  if (status === "deleted") return "−";
  return "~";
}

// ─── Header (rendered by Sidebar) ───

export function HistoryHeader() {
  const isLoading = useHistoryStore((s) => s.isLoading);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const loadSnapshots = useHistoryStore((s) => s.loadSnapshots);

  return (
    <div className="flex w-full items-center justify-between px-3">
      <div className="flex items-center gap-2">
        <HistoryIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-xs">History</span>
      </div>
      <button
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        onClick={() => projectRoot && loadSnapshots(projectRoot)}
        title="Refresh"
      >
        <RotateCcwIcon className={cn("size-3.5", isLoading && "animate-spin")} />
      </button>
    </div>
  );
}

// ─── Panel ───

export function HistoryPanel() {
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const snapshots = useHistoryStore((s) => s.snapshots);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const isRestoring = useHistoryStore((s) => s.isRestoring);
  const diffResult = useHistoryStore((s) => s.diffResult);
  const isDiffLoading = useHistoryStore((s) => s.isDiffLoading);
  const init = useHistoryStore((s) => s.init);
  const loadSnapshots = useHistoryStore((s) => s.loadSnapshots);
  const loadMoreSnapshots = useHistoryStore((s) => s.loadMoreSnapshots);
  const loadDiff = useHistoryStore((s) => s.loadDiff);
  const restoreSnapshot = useHistoryStore((s) => s.restoreSnapshot);
  const addLabel = useHistoryStore((s) => s.addLabel);
  const removeLabel = useHistoryStore((s) => s.removeLabel);
  const openProject = useDocumentStore((s) => s.openProject);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [labelTargetId, setLabelTargetId] = useState<string | null>(null);
  const [labelValue, setLabelValue] = useState("");

  // Init history when project opens
  useEffect(() => {
    if (!projectRoot) return;
    init(projectRoot).then(() => loadSnapshots(projectRoot)).catch(console.error);
  }, [projectRoot, init, loadSnapshots]);

  // Infinite scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !projectRoot || isLoading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMoreSnapshots(projectRoot);
    }
  }, [projectRoot, isLoading, loadMoreSnapshots]);

  // Double-click to expand and load diff
  const handleDoubleClick = useCallback(
    async (snap: SnapshotInfo) => {
      if (!projectRoot) return;
      if (expandedId === snap.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(snap.id);
      // Find parent snapshot (the one right after in the list)
      const idx = snapshots.findIndex((s) => s.id === snap.id);
      const parent = snapshots[idx + 1];
      if (parent) {
        await loadDiff(projectRoot, parent.id, snap.id);
      }
    },
    [projectRoot, snapshots, expandedId, loadDiff],
  );

  const handleRestore = useCallback(
    async (snapshotId: string) => {
      if (!projectRoot) return;
      await restoreSnapshot(projectRoot, snapshotId);
      // Re-open project to fully reload all file contents into editor
      await openProject(projectRoot);
    },
    [projectRoot, restoreSnapshot, openProject],
  );

  const handleAddLabel = useCallback(async () => {
    const label = labelValue.trim();
    if (!label || !labelTargetId || !projectRoot) return;
    await addLabel(projectRoot, labelTargetId, label);
    setLabelDialogOpen(false);
    setLabelValue("");
    setLabelTargetId(null);
  }, [projectRoot, labelTargetId, labelValue, addLabel]);

  const openLabelDialog = useCallback((snapshotId: string) => {
    setLabelTargetId(snapshotId);
    setLabelValue("");
    setLabelDialogOpen(true);
  }, []);

  if (!projectRoot) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
        <p className="text-[11px] text-muted-foreground">Open a project to view history.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {snapshots.length === 0 && !isLoading ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No history yet
          </div>
        ) : (
          <div className="py-0.5">
            {snapshots.map((snap) => (
              <SnapshotRow
                key={snap.id}
                snapshot={snap}
                isExpanded={expandedId === snap.id}
                isRestoring={isRestoring}
                diffResult={expandedId === snap.id ? diffResult : null}
                isDiffLoading={expandedId === snap.id && isDiffLoading}
                onDoubleClick={() => handleDoubleClick(snap)}
                onRestore={() => handleRestore(snap.id)}
                onAddLabel={() => openLabelDialog(snap.id)}
                onRemoveLabel={(label) => projectRoot && removeLabel(projectRoot, label)}
                onCopySha={() => navigator.clipboard.writeText(snap.id)}
              />
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-2">
            <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Label dialog */}
      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Label</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. Draft v1"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddLabel(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddLabel} disabled={!labelValue.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Snapshot Row ───

function SnapshotRow({
  snapshot,
  isExpanded,
  isRestoring,
  diffResult,
  isDiffLoading,
  onDoubleClick,
  onRestore,
  onAddLabel,
  onRemoveLabel,
  onCopySha,
}: {
  snapshot: SnapshotInfo;
  isExpanded: boolean;
  isRestoring: boolean;
  diffResult: FileDiff[] | null;
  isDiffLoading: boolean;
  onDoubleClick: () => void;
  onRestore: () => void;
  onAddLabel: () => void;
  onRemoveLabel: (label: string) => void;
  onCopySha: () => void;
}) {
  const hasFiles = snapshot.changed_files.length > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <button
            className={cn(
              "group flex w-full items-start px-2 py-1 text-left transition-colors",
              isExpanded ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
            )}
            onDoubleClick={onDoubleClick}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "rounded px-1 py-px text-[10px] leading-tight",
                    snapshotTypeBadgeColor(snapshot.message),
                  )}
                >
                  {snapshotTypeLabel(snapshot.message)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(snapshot.timestamp)}
                </span>
              </div>

              {/* Labels */}
              {snapshot.labels.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {snapshot.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      <TagIcon className="size-2" />
                      {label}
                      <button
                        className="ml-0.5 rounded-sm opacity-0 hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); onRemoveLabel(label); }}
                      >
                        <XIcon className="size-2" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Changed files summary */}
              {hasFiles && (
                <div className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  {isExpanded ? (
                    <ChevronDownIcon className="size-2.5 shrink-0" />
                  ) : (
                    <ChevronRightIcon className="size-2.5 shrink-0" />
                  )}
                  <span className="truncate">
                    {snapshot.changed_files.map((f) => f.split("/").pop()).join(", ")}
                  </span>
                </div>
              )}
            </div>
          </button>

          {/* Expanded diff view */}
          {isExpanded && hasFiles && (
            <div className="ml-3 border-border border-l pl-2">
              {isDiffLoading ? (
                <div className="flex items-center gap-1 py-1 text-[10px] text-muted-foreground">
                  <LoaderIcon className="size-2.5 animate-spin" />
                  Loading diff...
                </div>
              ) : diffResult ? (
                <div className="py-0.5">
                  {diffResult.map((diff) => (
                    <DiffFileRow key={diff.file_path} diff={diff} />
                  ))}
                </div>
              ) : (
                <div className="py-0.5">
                  {snapshot.changed_files.map((filePath) => (
                    <div key={filePath} className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-muted-foreground">
                      <FileTextIcon className="size-2.5 shrink-0" />
                      <span className="truncate">{filePath}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRestore} disabled={isRestoring}>
          <RotateCcwIcon className="mr-2 size-3.5" />
          Restore this version
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddLabel}>
          <PlusIcon className="mr-2 size-3.5" />
          Add label
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCopySha}>
          <CopyIcon className="mr-2 size-3.5" />
          Copy SHA
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── Diff File Row ───

function DiffFileRow({ diff }: { diff: FileDiff }) {
  const [expanded, setExpanded] = useState(false);
  const fileName = diff.file_path.split("/").pop() || diff.file_path;

  return (
    <div>
      <button
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-sidebar-accent/50"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={cn("font-mono font-bold", diffStatusColor(diff.status))}>
          {diffStatusPrefix(diff.status)}
        </span>
        <FileTextIcon className="size-2.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-muted-foreground">{fileName}</span>
      </button>

      {expanded && (
        <div className="mx-1 mb-1 max-h-48 overflow-auto rounded border border-border bg-muted/30 p-1 font-mono text-[9px] leading-relaxed">
          {renderInlineDiff(diff)}
        </div>
      )}
    </div>
  );
}

// ─── Inline Diff Renderer ───

function renderInlineDiff(diff: FileDiff) {
  const oldLines = diff.old_content?.split("\n") ?? [];
  const newLines = diff.new_content?.split("\n") ?? [];

  if (diff.status === "added") {
    return (
      <div>
        {newLines.slice(0, 50).map((line, i) => (
          <div key={i} className="bg-green-500/10 text-green-700 dark:text-green-400">
            <span className="mr-1 select-none text-green-500/50">+</span>{line}
          </div>
        ))}
        {newLines.length > 50 && (
          <div className="text-muted-foreground">... {newLines.length - 50} more lines</div>
        )}
      </div>
    );
  }

  if (diff.status === "deleted") {
    return (
      <div>
        {oldLines.slice(0, 50).map((line, i) => (
          <div key={i} className="bg-red-500/10 text-red-700 dark:text-red-400">
            <span className="mr-1 select-none text-red-500/50">−</span>{line}
          </div>
        ))}
        {oldLines.length > 50 && (
          <div className="text-muted-foreground">... {oldLines.length - 50} more lines</div>
        )}
      </div>
    );
  }

  // Modified: simple line-by-line comparison
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diffLines: { type: "ctx" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;

  // Simple LCS-like comparison: show removed then added for changed regions
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffLines.push({ type: "ctx", text: oldLines[i] });
      i++;
      j++;
    } else {
      // Collect differing lines
      const startI = i;
      const startJ = j;
      // Advance until we find a common line or exhaust both
      while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
        i++;
        j++;
      }
      // If still not matching, try to find next match
      if (i < oldLines.length && j < newLines.length) {
        // Both advanced same amount, output as changes
      }
      for (let k = startI; k < i; k++) {
        diffLines.push({ type: "del", text: oldLines[k] });
      }
      for (let k = startJ; k < j; k++) {
        diffLines.push({ type: "add", text: newLines[k] });
      }
      if (i >= oldLines.length && j < newLines.length) {
        while (j < newLines.length) {
          diffLines.push({ type: "add", text: newLines[j] });
          j++;
        }
      }
      if (j >= newLines.length && i < oldLines.length) {
        while (i < oldLines.length) {
          diffLines.push({ type: "del", text: oldLines[i] });
          i++;
        }
      }
    }
    if (diffLines.length > 100) break;
  }

  // Trim to show only changed regions with context
  const relevant: typeof diffLines = [];
  const CONTEXT = 2;
  const changedIndices = new Set<number>();
  diffLines.forEach((line, idx) => {
    if (line.type !== "ctx") {
      for (let c = Math.max(0, idx - CONTEXT); c <= Math.min(diffLines.length - 1, idx + CONTEXT); c++) {
        changedIndices.add(c);
      }
    }
  });

  let lastShown = -1;
  for (let idx = 0; idx < diffLines.length; idx++) {
    if (changedIndices.has(idx)) {
      if (lastShown >= 0 && idx - lastShown > 1) {
        relevant.push({ type: "ctx", text: "···" });
      }
      relevant.push(diffLines[idx]);
      lastShown = idx;
    }
  }

  if (relevant.length === 0) {
    return <div className="text-muted-foreground">No visible changes</div>;
  }

  return (
    <div>
      {relevant.map((line, i) => (
        <div
          key={i}
          className={cn(
            line.type === "del" && "bg-red-500/10 text-red-700 dark:text-red-400",
            line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
            line.type === "ctx" && "text-muted-foreground",
          )}
        >
          <span className={cn("mr-1 select-none", {
            "text-red-500/50": line.type === "del",
            "text-green-500/50": line.type === "add",
            "text-muted-foreground/50": line.type === "ctx",
          })}>
            {line.type === "del" ? "−" : line.type === "add" ? "+" : " "}
          </span>
          {line.text}
        </div>
      ))}
    </div>
  );
}
