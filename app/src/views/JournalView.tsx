import './workflow.css';
import { radioKeyIndex } from '../radioKeys';
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

export default function JournalView(props: { initialDate?: string }) {
  const today = todayStr();
  const [date, setDate] = useState(props.initialDate ?? today);
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
      <p className="workflow-hint">A page for each day. Your mood, highlight and notes save as you go. Use the date control to return to an earlier entry.</p>
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
        <input
          type="date"
          className="journal-jump"
          aria-label="Jump to date"
          value={date}
          max={today}
          onChange={(e) => { if (e.target.value) setDate(e.target.value); }}
        />
      </div>
      <div className="mood-strip" role="navigation" aria-label="Recent days">
        {Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => {
          const e = (entries ?? []).find((x) => x.date === d);
          const MoodIcon = e?.mood ? MOODS.find((m) => m.v === e.mood)?.Icon : null;
          const hasText = !!(e?.note.trim() || e?.highlight?.trim());
          return (
            <button
              key={d}
              className={`mood-dot${d === date ? ' viewing' : ''}${e?.mood ? ` mood-${e.mood}` : ''}`}
              title={friendlyDate(d, today) + (e?.mood ? ` - ${MOODS.find((m) => m.v === e.mood)?.label}` : hasText ? ' - entry' : ' - no entry')}
              aria-label={`${friendlyDate(d, today)}${e?.mood ? `, mood ${MOODS.find((m) => m.v === e.mood)?.label}` : hasText ? ', entry' : ', no entry'}`}
              onClick={() => setDate(d)}
            >
              {MoodIcon ? <MoodIcon size={13} strokeWidth={2} aria-hidden="true" /> : <span className={`mood-dot-inner${hasText ? ' has-text' : ''}`} />}
              <span className="mood-dot-day num">{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <div className="mood-row" role="radiogroup" aria-label="Mood">
        {MOODS.map(({ v, Icon, label }, index) => (
          <button
            key={v}
            role="radio"
            aria-checked={entry?.mood === v}
            tabIndex={entry?.mood === v || (!entry?.mood && index === 0) ? 0 : -1}
            onKeyDown={e => {
              const next = radioKeyIndex(e.key, index, MOODS.length);
              if (next === null) return;
              e.preventDefault();
              e.currentTarget.closest('[role=radiogroup]')?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
              void getOrCreateJournalEntry(date).then(entry => updateJournalEntry(entry.id, { mood: MOODS[next].v }));
            }}
            className={`mood-btn ${entry?.mood === v ? 'active' : ''}`}
            title={label}
            onClick={() => void getOrCreateJournalEntry(date).then((e) => updateJournalEntry(e.id, { mood: entry?.mood === v ? null : v }))}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <label className="highlight-field">
        <span className="highlight-label">Today's highlight (optional one-liner, shows on the TV)</span>
        <input
          key={`hl-${date}`}
          type="text"
          defaultValue={entry?.highlight ?? ''}
          placeholder="One line about today"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value;
              void getOrCreateJournalEntry(date).then((en) => updateJournalEntry(en.id, { highlight: v.trim() || null }));
            }
          }}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (entry?.highlight ?? '')) {
              void getOrCreateJournalEntry(date).then((en) => updateJournalEntry(en.id, { highlight: v.trim() || null }));
            }
          }}
        />
      </label>
      <div className="journal-editor">
        {entries !== undefined && (
        <NoteEditor collection="journal"
          key={date}
          docKey={date}
          note={entry?.note ?? ''}
          noteDoc={entry?.noteDoc ?? null}
          onSave={(doc, text) =>
            getOrCreateJournalEntry(date).then((e) => updateJournalEntry(e.id, { noteDoc: doc, note: text }))
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
