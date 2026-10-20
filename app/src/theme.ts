export type Theme = 'light' | 'dark' | 'system';
export type StyleId = 'paper' | 'terminal' | 'editorial' | 'soft' | 'contrast';

export const STYLES: { id: StyleId; name: string; blurb: string }[] = [
  { id: 'paper', name: 'Paper', blurb: 'Calm and neutral. The default.' },
  { id: 'terminal', name: 'Terminal', blurb: 'Monospace, square corners, dense rows.' },
  { id: 'editorial', name: 'Editorial', blurb: 'Serif headings, cream paper, hairline rules.' },
  { id: 'soft', name: 'Soft', blurb: 'Rounded, airy, gentle shadows.' },
  { id: 'contrast', name: 'High contrast', blurb: 'Heavy borders and larger text for legibility.' },
];

const KEY = 'lifedash-theme';
const STYLE_KEY = 'lifedash-style';
const META_COLORS: Record<StyleId, [string, string]> = {
  paper: ['#f7f7f4', '#111110'],
  terminal: ['#f2f5ef', '#0b0f0c'],
  editorial: ['#f6f0e4', '#1a1612'],
  soft: ['#f5f3fb', '#16151f'],
  contrast: ['#ffffff', '#000000'],
};

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function getStyle(): StyleId {
  const v = localStorage.getItem(STYLE_KEY);
  return STYLES.some((s) => s.id === v) ? (v as StyleId) : 'paper';
}

function syncMeta() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const [l, d] = META_COLORS[getStyle()];
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? d : l;
  document.head.appendChild(meta);
}

export function applyTheme(t: Theme) {
  const dark =
    t === 'dark' ||
    (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem(KEY, t);
  syncMeta();
}

export function applyStyle(s: StyleId) {
  document.documentElement.dataset.style = s;
  localStorage.setItem(STYLE_KEY, s);
  syncMeta();
}

export function cycleTheme(): Theme {
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  applyTheme(next);
  return next;
}

export function initTheme() {
  applyStyle(getStyle());
  applyTheme(getTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}
