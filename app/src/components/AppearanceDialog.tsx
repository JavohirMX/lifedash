import { useEffect, useState, type KeyboardEvent, type CSSProperties } from 'react';
import { radioKeyIndex } from '../radioKeys';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { STYLES, applyStyle, applyTheme, getStyle, getTheme, type StyleId, type Theme } from '../theme';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './AppearanceDialog.css';
import PersonalizationControls from './PersonalizationControls';
import { THEME_PREVIEWS } from '../themePreviews';

const MODES: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

export default function AppearanceDialog(props: { onClose: () => void }) {
  const [section, setSection] = useState<'style' | 'font' | 'wallpaper'>('style');
  const [style, setStyle] = useState<StyleId>(getStyle());
  const [mode, setMode] = useState<Theme>(getTheme());
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const previewMode = mode === 'system' ? systemDark ? 'dark' : 'light' : mode;


  const panel = useDialogFocus<HTMLDivElement>(props.onClose, '[aria-checked="true"]');

  const navigate = (e: KeyboardEvent<HTMLButtonElement>, index: number, count: number, select: (index: number) => void) => {
    const next = radioKeyIndex(e.key, index, count);
    if (next === null) return;
    e.preventDefault();
    select(next);
    const group = e.currentTarget.closest('[role=radiogroup]');
    group?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
  };

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel appearance-panel" role="dialog" aria-modal="true" aria-label="Appearance" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Appearance</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>
        <p className="rule-note">Make Lifedash your own. Changes apply immediately and are saved on this device.</p>
        <div className="appearance-summary">
          <p className="appearance-current" role="status">Current: <strong>{STYLES.find(s => s.id === style)?.name}</strong> · {mode === 'system' ? `System (${previewMode})` : `${MODES.find(m => m.id === mode)?.label} mode`}</p>
          <button className="btn-secondary appearance-reset" title="Reset style and mode to Paper and System; font and wallpaper stay unchanged" onClick={() => { applyStyle('paper'); applyTheme('system'); setStyle('paper'); setMode('system'); }}>Reset style &amp; mode</button>
        </div>
        <div className="appearance-sections" role="tablist" aria-label="Appearance sections">
          {(['style','font','wallpaper'] as const).map((id,index)=><button key={id} role="tab" id={`appearance-tab-${id}`} aria-controls={`appearance-section-${id}`} aria-selected={section===id} tabIndex={section===id?0:-1} onClick={()=>setSection(id)} onKeyDown={e=>{const next=radioKeyIndex(e.key,index,3);if(next===null)return;e.preventDefault();const id=(['style','font','wallpaper'] as const)[next];setSection(id);document.getElementById(`appearance-tab-${id}`)?.focus();}}>{id==='style'?'Style & mode':id==='font'?'Font':'Wallpaper'}</button>)}
        </div>
        <div role="tabpanel" id="appearance-section-style" aria-labelledby="appearance-tab-style" hidden={section!=='style'}>
        <h3 className="appearance-section-title">Mode</h3>
        <div className="mode-seg" role="radiogroup" aria-label="Mode">
          {MODES.map(({ id, label, Icon }, index) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              tabIndex={mode === id ? 0 : -1}
              onKeyDown={e => navigate(e, index, MODES.length, next => { applyTheme(MODES[next].id); setMode(MODES[next].id); })}
              className={mode === id ? 'active' : ''}
              onClick={() => { applyTheme(id); setMode(id); }}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <h3 className="appearance-section-title">Style <span>Changes apply immediately</span></h3>
        <div className="style-grid" role="radiogroup" aria-label="Style">
          {STYLES.map((s, index) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={style === s.id}
              tabIndex={style === s.id ? 0 : -1}
              onKeyDown={e => navigate(e, index, STYLES.length, next => { applyStyle(STYLES[next].id); setStyle(STYLES[next].id); })}
              className={`style-card${style === s.id ? ' active' : ''}`}
              data-preview={s.id}
              onClick={() => { applyStyle(s.id); setStyle(s.id); }}
            >
              <span className="style-preview" style={THEME_PREVIEWS[s.id][previewMode] as CSSProperties} aria-hidden="true">
                <span className="sp-side" />
                <span className="sp-main">
                  <span className="sp-title" />
                  <span className="sp-row"><i /><b /></span>
                  <span className="sp-row"><i /><b /></span>
                </span>
              </span>
              <span className="style-name">{s.name}<span className="style-selected" aria-hidden="true">{style === s.id ? '✓' : ''}</span></span>
              <span className="style-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
        </div>
        <PersonalizationControls section={section} />
      </div>
    </div>
  );
}
