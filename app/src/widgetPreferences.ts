import { db } from './db';

// Keep visibility writes ordered across Home unmount/remount in this page.
let pending: Promise<unknown> = Promise.resolve();
export function saveWidgetVisibility(id: string, visible: boolean): Promise<void> {
  const save = pending.then(async () => {
    const row = await db.syncmeta.get('home.widgets');
    const hidden = (row?.value as string[] | undefined) ?? [];
    const next = visible ? hidden.filter(w => w !== id) : [...new Set([...hidden, id])];
    await db.syncmeta.put({ key: 'home.widgets', value: next });
  });
  pending = save.catch(() => {});
  return save;
}
