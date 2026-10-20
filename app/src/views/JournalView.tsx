import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, ChevronLeft, ChevronRight, Frown, Meh, Smile, CloudRain, Laugh } from 'lucide-react';
import { db } from '../db';
import { getOrCreateJournalEntry, updateJournalEntry } from '../repo';
import { todayStr, addDays, friendlyDate } from '../dates';
import NoteEditor from '../components/NoteEditor';

const MOODS = [
  { v: 1, Icon: CloudRain, label: 'Rough' },
  { v: 2, Icon: Frown, label: 'Low' },
  { v: 3, Icon: Meh, label: 'Okay' },
  { v: 4, Icon: Smile, label: 'Good' },
  { v: 5, Icon: Laugh, label: 'Great' },
];

export default function JournalView() {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const entries = useLiveQuery(() => db.journal.toArray(), []);
  const entry = (entries ?? []).find((e) => e.date === date) ?? null;
  const hasEntries = (entries ?? []).length > 0;

  // Count consecutive days with an entry ending today (or yesterday if today empty)
  const dates = new Set((entries ?? []).filter((e) => e.note.trim() || e.mood !== null).map((e) => e.date));
  let streak = 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  useEffect(() => {
    // create today's entry lazily only when typing starts; nothing to do here
  }, [date]);

  return (
    <section>
      <h1>
        Journal {streak > 0 && <span className="date-sub num">{streak}-day streak</span>}
      </h1>
      <div className="journal-nav">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <strong className="journal-date">{date === today ? 'Today' : friendlyDate(date, today)}</strong>
        <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight size={16} strokeWidth={2} />
        </button>
        {date !== today && (
          <button className="mini" onClick={() => setDate(today)}>Today</button>
        )}
      </div>
      <div className="mood-row" role="radiogroup" aria-label="Mood">
        {MOODS.map(({ v, Icon, label }) => (
          <button
            key={v}
            role="radio"
            aria-checked={entry?.mood === v}
            className={`mood-btn ${entry?.mood === v ? 'active' : ''}`}
            title={label}
            onClick={() => void getOrCreateJournalEntry(date).then((e) => updateJournalEntry(e.id, { mood: entry?.mood === v ? null : v }))}
          >
            <Icon size={18} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <div className="journal-editor">
        {entries !== undefined && (
        <NoteEditor
          key={date}
          docKey={date}
          note={entry?.note ?? ''}
          noteDoc={entry?.noteDoc ?? null}
          onSave={(doc, text) =>
            void getOrCreateJournalEntry(date).then((e) => updateJournalEntry(e.id, { noteDoc: doc, note: text }))
          }
        />
        )}
      </div>
      {!hasEntries && (
        <div className="empty goals-empty">
          <BookOpen size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>One page a day. Pick a mood, write a few lines - entries save as you type.</p>
        </div>
      )}
    </section>
  );
}
