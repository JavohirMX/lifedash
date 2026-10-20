import { X, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addAttachment, deleteAttachment } from '../repo';
import type { Attachment } from '../types';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Thumb(props: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!props.att.mime.startsWith('image/')) return;
    const u = URL.createObjectURL(props.att.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [props.att]);
  if (!url) return <Paperclip size={16} strokeWidth={1.75} className="att-icon" aria-label="File attachment" />;
  return <img src={url} alt={props.att.name} className="att-thumb" />;
}

function downloadAttachment(a: Attachment): void {
  const url = URL.createObjectURL(a.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function Attachments(props: { taskId: string }) {
  const atts = useLiveQuery(() => db.attachments.where('taskId').equals(props.taskId).toArray(), [props.taskId]);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="subs">
      <h3>Attachments</h3>
      {(atts ?? []).map((a) => (
        <div key={a.id} className="att-row">
          <Thumb att={a} />
          <button className="att-name att-open" title={`Download ${a.name}`} aria-label={`Download ${a.name}`} onClick={() => downloadAttachment(a)}>{a.name}</button>
          <span className="att-size">{fmtSize(a.byteSize)}</span>
          <button className="mini" title="Remove" aria-label="Remove attachment" onClick={() => void deleteAttachment(a.id)}><X size={13} strokeWidth={2} /></button>
        </div>
      ))}
      <input aria-label="Attach files"
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addAttachment(props.taskId, f);
          e.target.value = '';
        }}
      />
      <button className="mini" onClick={() => inputRef.current?.click()}>Attach a file</button>
    </div>
  );
}
