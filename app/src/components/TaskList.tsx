import { useState } from 'react';
import TaskRow from './TaskRow';
import type { Task } from '../types';

const MIME = 'application/x-lifedash-task';

// A task list with optional HTML5 drag-to-reorder. onReorder receives the
// dragged task id, the drop-target row id and whether it lands after it.
export default function TaskList(props: {
  tasks: Task[];
  allTasks: Task[];
  showDate?: boolean;
  onOpen: (id: string) => void;
  onReorder?: (dragId: string, targetId: string, after: boolean) => void;
}) {
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const dnd = !!props.onReorder;

  return (
    <div onDragEnd={() => setOver(null)}>
      {props.tasks.map((t) => (
        <div
          key={t.id}
          draggable={dnd}
          className={over?.id === t.id ? (over.after ? 'drop-after' : 'drop-before') : ''}
          onDragStart={
            dnd
              ? (e) => {
                  e.dataTransfer.setData(MIME, t.id);
                  e.dataTransfer.effectAllowed = 'move';
                }
              : undefined
          }
          onDragOver={
            dnd
              ? (e) => {
                  if (!e.dataTransfer.types.includes(MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  setOver({ id: t.id, after: e.clientY > r.top + r.height / 2 });
                }
              : undefined
          }
          onDrop={
            dnd
              ? (e) => {
                  const id = e.dataTransfer.getData(MIME);
                  if (!id) return;
                  e.preventDefault();
                  const after = over?.id === t.id ? over.after : false;
                  setOver(null);
                  props.onReorder!(id, t.id, after);
                }
              : undefined
          }
        >
          <TaskRow task={t} allTasks={props.allTasks} showDate={props.showDate} onOpen={props.onOpen} />
        </div>
      ))}
    </div>
  );
}

export const TASK_DRAG_MIME = MIME;
