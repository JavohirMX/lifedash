// Page-session rich-text drafts, never persisted separately from their record.
export type EditorDraft = { doc: unknown; text: string; revision: number; status: 'pending' | 'error' };
export const editorDrafts = new Map<string, EditorDraft>();
export function discardDeletedEditorDraft(database: string, collection: 'tasks' | 'notes', id: string) {
  editorDrafts.delete(JSON.stringify([database, collection, id]));
}
