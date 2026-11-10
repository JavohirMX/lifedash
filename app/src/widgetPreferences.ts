import { db } from './db';

export const DEFAULT_HIDDEN_WIDGETS: readonly string[] = ['upcoming', 'week', 'goals'];

// Keep visibility writes ordered across Home unmount/remount in this page.
let pending: Promise<unknown> = Promise.resolve();
export function saveWidgetVisibility(id: string, visible: boolean): Promise<void> {
  const save = pending.then(async () => {
    const row = await db.syncmeta.get('home.widgets');
    const hidden = Array.isArray(row?.value) ? (row.value as string[]) : [...DEFAULT_HIDDEN_WIDGETS];
    const next = visible ? hidden.filter(w => w !== id) : [...new Set([...hidden, id])];
    await db.syncmeta.put({ key: 'home.widgets', value: next });
  });
  pending = save.catch(() => {});
  return save;
}
