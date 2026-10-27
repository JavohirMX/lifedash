// Fictional browser regression fixture, never imported by the app entry point.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import NoteEditor from '../../src/components/NoteEditor';
const pending = new URLSearchParams(location.search).has('pending');
let release: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });
let saved = 'ORIGINAL';
Object.assign(window, { readSaved: () => saved, releaseSave: () => release() });
function Fixture() {
  const [collection, setCollection] = useState<'notes' | 'tasks'>('notes');
  const [show, setShow] = useState(true);
  return <>
    <button onClick={() => setCollection(collection === 'notes' ? 'tasks' : 'notes')}>Switch record kind</button>
    <button onClick={() => setShow(!show)}>Toggle editor</button>
    <h1>{collection}</h1>
    {show && <NoteEditor key={collection} collection={collection} docKey="shared-valid-import-id" note={pending ? saved : collection === 'notes' ? 'Note original' : 'Task original'} noteDoc={null} onSave={async (_doc, text) => {
      if (!pending) throw Error('Synthetic write failure');
      await gate;
      saved = text;
    }} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
