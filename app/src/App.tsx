import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID } from './db';
import Sidebar, { type Selection } from './components/Sidebar';
import QuickAdd from './components/QuickAdd';
import TaskRow from './components/TaskRow';
import TaskDetail from './components/TaskDetail';
import {
  todayTasks,
  upcomingTasks,
  backlogTasks,
  projectTasks,
  completedTasks,
  searchTasks,
} from './logic';
import { todayStr, friendlyDate, weekdayLabel } from './dates';
import { updateTask } from './repo';

export default function App() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const [selection, setSelection] = useState<Selection>({ kind: 'today' });
  const [openId, setOpenId] = useState<string | null>(null);

  const today = todayStr();

  const counts = useMemo(() => {
    const all = tasks ?? [];
    return {
      today: todayTasks(all, today).length,
      backlog: backlogTasks(all).length,
    };
  }, [tasks, today]);

  if (!tasks || !projects) {
    return <div className="boot">Loading LifeDash...</div>;
  }

  const quickAddContext = (() => {
    if (selection.kind === 'today') return { projectId: INBOX_ID, dueDate: today };
    if (selection.kind === 'project') return { projectId: selection.id, dueDate: null };
    return { projectId: INBOX_ID, dueDate: null };
  })();
  const showQuickAdd = selection.kind !== 'completed' && selection.kind !== 'search';

  let body;
  if (selection.kind === 'today') {
    const list = todayTasks(tasks, today);
    body = (
      <section>
        <h1>Today <span className="date-sub">{friendlyDate(today, today)} · {weekdayLabel(today)}</span></h1>
        {list.length === 0 && <p className="empty">Nothing due today. Enjoy, or pull something in from Backlog.</p>}
        {list.map((t) => (
          <TaskRow key={t.id} task={t} allTasks={tasks} showDate onOpen={setOpenId} />
        ))}
      </section>
    );
  } else if (selection.kind === 'upcoming') {
    const groups = upcomingTasks(tasks, today);
    body = (
      <section>
        <h1>Upcoming</h1>
        {groups.size === 0 && <p className="empty">Nothing scheduled in the next two weeks.</p>}
        {[...groups.entries()].map(([date, list]) => (
          <div key={date} className="day-group">
            <h2>{friendlyDate(date, today)} <span className="date-sub">{weekdayLabel(date)}</span></h2>
            {list.map((t) => (
              <TaskRow key={t.id} task={t} allTasks={tasks} onOpen={setOpenId} />
            ))}
          </div>
        ))}
      </section>
    );
  } else if (selection.kind === 'backlog') {
    const list = backlogTasks(tasks);
    body = (
      <section>
        <h1>Backlog</h1>
        {list.length === 0 && <p className="empty">Backlog is empty. Quick-add below to park something here.</p>}
        {list.map((t) => (
          <div key={t.id} className="backlog-row">
            <TaskRow task={t} allTasks={tasks} onOpen={setOpenId} />
            <button className="mini" onClick={() => void updateTask(t.id, { dueDate: today })}>
              → Today
            </button>
          </div>
        ))}
      </section>
    );
  } else if (selection.kind === 'completed') {
    const list = completedTasks(tasks);
    body = (
      <section>
        <h1>Completed</h1>
        {list.length === 0 && <p className="empty">Nothing completed yet.</p>}
        {list.slice(0, 100).map((t) => (
          <TaskRow key={t.id} task={t} allTasks={tasks} showDate onOpen={setOpenId} />
        ))}
      </section>
    );
  } else if (selection.kind === 'search') {
    const results = searchTasks(tasks, selection.query);
    body = (
      <section>
        <h1>Search <span className="date-sub">{results.length} result{results.length === 1 ? '' : 's'}</span></h1>
        {results.length === 0 && <p className="empty">No tasks match. Tip: #tag filters by tag.</p>}
        {results.map((t) => (
          <TaskRow key={t.id} task={t} allTasks={tasks} showDate onOpen={setOpenId} />
        ))}
      </section>
    );
  } else if (selection.kind === 'project') {
    const project = projects.find((p) => p.id === selection.id);
    const list = projectTasks(tasks, selection.id);
    body = (
      <section>
        <h1>
          <span className="dot" style={{ background: project?.color }} /> {project?.name ?? 'Project'}
        </h1>
        {list.length === 0 && <p className="empty">No active tasks in this project.</p>}
        {list.map((t) => (
          <TaskRow key={t.id} task={t} allTasks={tasks} showDate onOpen={setOpenId} />
        ))}
      </section>
    );
  }

  return (
    <div className="app">
      <Sidebar projects={projects} selection={selection} onSelect={setSelection} counts={counts} />
      <main>
        {showQuickAdd && (
          <QuickAdd
            projectId={quickAddContext.projectId}
            dueDate={quickAddContext.dueDate}
          />
        )}
        {body}
      </main>
      {openId && <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
