import { X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { CompletionPrompt } from '../completionPrompt';
export default function CompletionDialog({ prompt }: { prompt: CompletionPrompt }) {
  const cancel = () => prompt.resolve('cancel');
  const panel = useDialogFocus<HTMLDivElement>(cancel);
  const blocked = prompt.kind === 'blocked';
  return <div className="palette-overlay" onClick={cancel}>
    <div ref={panel} className="import-panel completion-panel" role="dialog" aria-modal="true" aria-label={blocked ? 'Task is blocked' : 'Open subtasks'} onClick={e=>e.stopPropagation()}>
      <div className="import-head"><h2>{blocked ? 'Task is blocked' : 'Open subtasks'}</h2><button className="icon-btn" aria-label="Cancel completion" onClick={cancel}><X size={18}/></button></div>
      <p>{blocked ? `Complete "${prompt.task.title}" even though these tasks are still open?` : `"${prompt.task.title}" has ${prompt.related.length} open subtask${prompt.related.length === 1 ? '' : 's'}. Complete them too?`}</p>
      <ul>{prompt.related.map(t=><li key={t.id}>{t.title}</li>)}</ul>
      <div className="completion-actions"><button className="btn-secondary" onClick={cancel}>Cancel</button>
        {!blocked && <button className="btn-secondary" onClick={()=>prompt.resolve('leave')}>Leave subtasks open</button>}
        <button className="btn-primary" onClick={()=>prompt.resolve('confirm')}>{blocked ? 'Complete anyway' : 'Complete all'}</button>
      </div>
    </div>
  </div>;
}
