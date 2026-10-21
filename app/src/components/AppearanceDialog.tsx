import { useState } from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { STYLES, applyStyle, applyTheme, getStyle, getTheme, type StyleId, type Theme } from '../theme';
import { useDialogFocus } from '../hooks/useDialogFocus';

const MODES: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

export default function AppearanceDialog(props: { onClose: () => void }) {
  const [style, setStyle] = useState<StyleId>(getStyle());
  const [mode, setMode] = useState<Theme>(getTheme());

  const panel = useDialogFocus<HTMLDivElement>(props.onClose, '[aria-checked="true"]');

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel appearance-panel" role="dialog" aria-modal="true" aria-label="Appearance" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Appearance</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>
        <p className="rule-note">Style changes type, shape, density and color. Mode switches light or dark. Both are saved on this device.</p>
        <div className="mode-seg" role="radiogroup" aria-label="Mode">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={mode === id ? 'active' : ''}
              onClick={() => { applyTheme(id); setMode(id); }}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <div className="style-grid" role="radiogroup" aria-label="Style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={style === s.id}
              className={`style-card${style === s.id ? ' active' : ''}`}
              data-preview={s.id}
              onClick={() => { applyStyle(s.id); setStyle(s.id); }}
            >
              <span className="style-preview" aria-hidden="true">
                <span className="sp-side" />
                <span className="sp-main">
                  <span className="sp-title" />
                  <span className="sp-row"><i /><b /></span>
                  <span className="sp-row"><i /><b /></span>
                </span>
              </span>
              <span className="style-name">{s.name}</span>
              <span className="style-blurb">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
