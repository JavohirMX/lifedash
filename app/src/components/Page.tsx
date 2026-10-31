import type { ReactNode } from 'react';

/** Page-level heading used by every primary view. */
export function PageHeader(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
      <div className="page-head-row">
        <h1>
          {props.title}
          {props.meta && <span className="date-sub">{props.meta}</span>}
        </h1>
        {props.actions && <div className="page-actions">{props.actions}</div>}
      </div>
      {props.description && <p className="page-meta">{props.description}</p>}
    </header>
  );
}

/** A labelled band inside a page, with optional trailing actions. */
export function PageSection(props: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={['page-section', props.className].filter(Boolean).join(' ')}>
      {(props.title || props.actions) && (
        <div className="page-section-head">
          {props.title && (
            <h2>
              {props.title}
              {props.meta && <span className="date-sub">{props.meta}</span>}
            </h2>
          )}
          {props.actions && <div className="page-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

/** Quiet empty state: one sentence and an optional next step. */
export function EmptyState(props: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p>{props.children}</p>
      {props.action && <div className="empty-state-action">{props.action}</div>}
    </div>
  );
}

/** Inline control strip for view-level filters and actions. */
export function Toolbar(props: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      className={['page-toolbar', props.className].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label={props.label}
    >
      {props.children}
    </div>
  );
}
