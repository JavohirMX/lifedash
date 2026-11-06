import { X, Plus } from 'lucide-react';
import { INBOX_ID } from '../db';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { Project } from '../types';
import QuickAdd from './QuickAdd';
import './capture-dialog.css';

export default function CaptureDialog({ open, projects, onClose }: { open: boolean; projects: Project[]; onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(onClose, '.quick-add input', open);
  // Keep this session's unsaved text and choices on close, without leaving a
  // hidden modal in the global keyboard guard or the accessibility tree.
  return (
    <div className="palette-overlay capture-overlay" style={open ? undefined : { display: 'none' }} onClick={onClose}>
      <div
        ref={panel}
        className="import-panel capture-panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Capture task"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="import-head capture-head">
          <div className="capture-head-title">
            <span className="capture-head-icon" aria-hidden="true">
              <Plus size={18} strokeWidth={2.5} />
            </span>
            <div>
              <h2>Capture task</h2>
              <span className="capture-head-hint">Add tasks with natural language dates, times, and #tags</span>
            </div>
          </div>
          <button type="button" className="icon-btn capture-close-btn" aria-label="Close capture" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <QuickAdd
          projectId={INBOX_ID}
          captureProjects={projects}
          placeholder="e.g. Review budget tomorrow 6pm #home p1"
          onClose={onClose}
        />
      </div>
    </div>
  );
}
