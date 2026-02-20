import { type FC } from "react";
import { Check, X } from "lucide-react";
import { type ProposedChange } from "@/stores/proposed-changes-store";

interface ProposedChangesPanelProps {
  change: ProposedChange;
  onKeep: () => void;
  onUndo: () => void;
}

export const ProposedChangesPanel: FC<ProposedChangesPanelProps> = ({
  change,
  onKeep,
  onUndo,
}) => {
  const oldLines = change.oldContent.split("\n").length;
  const newLines = change.newContent.split("\n").length;
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);

  return (
    <div className="flex items-center justify-between border-border border-t bg-muted/50 px-3 py-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-foreground">Proposed Changes</span>
        <span className="text-muted-foreground">{change.filePath}</span>
        <span className="text-muted-foreground">{change.toolName}</span>
        {added > 0 && <span className="text-green-400">+{added}</span>}
        {removed > 0 && <span className="text-red-400">-{removed}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onKeep}
          className="flex items-center gap-1 rounded-md bg-green-600/20 px-2.5 py-1 text-green-400 text-xs hover:bg-green-600/30 transition-colors"
        >
          <Check className="size-3.5" />
          Keep All
          <kbd className="ml-1 rounded bg-green-600/20 px-1 py-0.5 font-mono text-[10px]">
            ⌘Y
          </kbd>
        </button>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 rounded-md bg-red-600/20 px-2.5 py-1 text-red-400 text-xs hover:bg-red-600/30 transition-colors"
        >
          <X className="size-3.5" />
          Undo All
          <kbd className="ml-1 rounded bg-red-600/20 px-1 py-0.5 font-mono text-[10px]">
            ⌘N
          </kbd>
        </button>
      </div>
    </div>
  );
};
