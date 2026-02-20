import { create } from "zustand";
import { useDocumentStore } from "./document-store";
import { writeTexFileContent } from "@/lib/tauri/fs";

export interface ProposedChange {
  id: string; // tool_use_id
  filePath: string; // relativePath
  absolutePath: string;
  oldContent: string; // content before Claude's edit
  newContent: string; // content after Claude's edit (from disk)
  toolName: string; // "Edit" | "Write" | "MultiEdit"
  timestamp: number;
}

interface ProposedChangesState {
  changes: ProposedChange[];

  // Actions
  addChange: (
    change: Omit<ProposedChange, "timestamp">
  ) => void;
  resolveChange: (id: string) => void;
  keepChange: (id: string) => void;
  undoChange: (id: string) => Promise<void>;
  keepAll: () => void;
  undoAll: () => Promise<void>;
  getChangeForFile: (relativePath: string) => ProposedChange | undefined;
}

export const useProposedChangesStore = create<ProposedChangesState>()(
  (set, get) => ({
    changes: [],

    addChange: (change) => {
      set((state) => ({
        changes: [
          ...state.changes,
          { ...change, timestamp: Date.now() },
        ],
      }));
    },

    resolveChange: (id) => {
      set((state) => ({
        changes: state.changes.filter((c) => c.id !== id),
      }));
    },

    keepChange: (id) => {
      const change = get().changes.find((c) => c.id === id);
      if (!change) return;

      // Content is already newContent in the editor and on disk.
      // Just reload the file in document store to sync state.
      useDocumentStore.getState().reloadFile(change.filePath);

      // Remove from pending
      set((state) => ({
        changes: state.changes.filter((c) => c.id !== id),
      }));
    },

    undoChange: async (id) => {
      const change = get().changes.find((c) => c.id === id);
      if (!change) return;

      // Restore oldContent to disk
      await writeTexFileContent(change.absolutePath, change.oldContent);

      // Reload the file in document store (will pick up oldContent from disk)
      await useDocumentStore.getState().reloadFile(change.filePath);

      // Remove from pending
      set((state) => ({
        changes: state.changes.filter((c) => c.id !== id),
      }));
    },

    keepAll: () => {
      const { changes } = get();
      for (const change of changes) {
        useDocumentStore.getState().reloadFile(change.filePath);
      }
      set({ changes: [] });
    },

    undoAll: async () => {
      const { changes } = get();
      for (const change of changes) {
        await writeTexFileContent(change.absolutePath, change.oldContent);
        await useDocumentStore.getState().reloadFile(change.filePath);
      }
      set({ changes: [] });
    },

    getChangeForFile: (relativePath) => {
      return get().changes.find((c) => c.filePath === relativePath);
    },
  })
);
