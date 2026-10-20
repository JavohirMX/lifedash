import { useRef, useState } from 'react';
import TaskRow from './TaskRow';
import type { Task } from '../types';

const MIME = 'application/x-lifedash-task';
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;

// A task list with optional drag-to-reorder (HTML5 on desktop, long-press
// on touch). onReorder receives the dragged task id, the drop-target row id
// and whether it lands after it.
export default function TaskList(props: {
  tasks: Task[];
  allTasks: Task[];
  showDate?: boolean;
  onOpen: (id: string) => void;
  onReorder?: (dragId: string, targetId: string, after: boolean) => void;
}) {
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [touchDrag, setTouchDrag] = useState<{ id: string; startY: number; dy: number } | null>(null);
  const press = useRef<{ id: string; y: number; timer: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dnd = !!props.onReorder;

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const targetAt = (x: number, y: number): { id: string; after: boolean } | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-task-id]');
    if (!el || !listRef.current?.contains(el)) return null;
    const id = (el as HTMLElement).dataset.taskId!;
    if (id === touchDrag?.id) return null;
    const r = el.getBoundingClientRect();
    return { id, after: y > r.top + r.height / 2 };
  };

  // While a touch drag is active the finger may be over a different row, so
  // move/up/cancel live on the list container; only the press starts per-row.
  const rowTouchProps = (t: Task) =>
    dnd
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            cancelPress();
            const y = e.clientY;
            press.current = {
              id: t.id,
              y,
              timer: window.setTimeout(() => {
                setTouchDrag({ id: t.id, startY: y, dy: 0 });
                press.current = null;
              }, LONG_PRESS_MS),
            };
          },
          onPointerMove: (e: React.PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            if (press.current && Math.abs(e.clientY - press.current.y) > MOVE_CANCEL_PX) cancelPress();
          },
          onPointerUp: cancelPress,
          onPointerCancel: cancelPress,
        }
      : {};

  const listTouchProps = !dnd
    ? {}
    : {
        onPointerMove: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch' || !touchDrag) return;
          setTouchDrag({ ...touchDrag, dy: e.clientY - touchDrag.startY });
          setOver(targetAt(e.clientX, e.clientY));
        },
        onPointerUp: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch' || !touchDrag) return;
          const target = over ?? targetAt(e.clientX, e.clientY);
          const dragId = touchDrag.id;
          setTouchDrag(null);
          setOver(null);
          cancelPress();
          if (target) props.onReorder!(dragId, target.id, target.after);
        },
        onPointerCancel: () => {
          cancelPress();
          setTouchDrag(null);
          setOver(null);
        },
      };

  return (
    <div ref={listRef} onDragEnd={() => setOver(null)} style={touchDrag ? { touchAction: 'none' } : undefined} {...listTouchProps}>
      {props.tasks.map((t) => (
        <div
          key={t.id}
          data-task-id={t.id}
          draggable={dnd}
          className={[
            over?.id === t.id ? (over.after ? 'drop-after' : 'drop-before') : '',
            touchDrag?.id === t.id ? 'touch-dragging' : '',
          ].join(' ').trim()}
          style={touchDrag?.id === t.id ? { transform: `translateY(${touchDrag.dy}px)` } : undefined}
          onContextMenu={(e) => {
            if (touchDrag) e.preventDefault();
          }}
          {...rowTouchProps(t)}
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
