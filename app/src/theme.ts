export type Theme = 'light' | 'dark' | 'system';
export type StyleId = 'paper' | 'terminal' | 'editorial' | 'soft' | 'contrast' | 'nexus' | 'compact' | 'polar' | 'modern-dark' | 'playful-geometric' | 'cyberpunk' | 'luxury' | 'professional' | 'retro' | 'sketch' | 'monochrome';

export const STYLES: { id: StyleId; name: string; blurb: string }[] = [
  { id: 'paper', name: 'Paper', blurb: 'Calm and neutral. The default.' },
  { id: 'terminal', name: 'Terminal', blurb: 'Monospace, square corners, dense rows.' },
  { id: 'editorial', name: 'Editorial', blurb: 'Serif headings, cream paper, hairline rules.' },
  { id: 'soft', name: 'Soft', blurb: 'Rounded, airy, gentle shadows.' },
  { id: 'contrast', name: 'High contrast', blurb: 'Heavy borders and larger text for legibility.' },
  { id: 'nexus', name: 'Nexus', blurb: 'Dark-first glass panels, glow accents, TV-kiosk kin.' },
  { id: 'compact', name: 'Compact', blurb: 'Dense rows, small type, maximum tasks per screen.' },
  { id: 'polar', name: 'Polar', blurb: 'Cool, crisp and airy. Steel blue on snow.' },
  { id: 'modern-dark', name: 'Modern Dark', blurb: 'Near-black ground, hairline grids, one mint live signal.' },
  { id: 'playful-geometric', name: 'Playful Geometric', blurb: 'Outlined shapes, hard offset shadows, activity-book color.' },
  { id: 'cyberpunk', name: 'Cyberpunk', blurb: 'Black field, green signal rail, magenta and cyan fractures.' },
  { id: 'luxury', name: 'Luxury', blurb: 'Warm alabaster, gilt rules, Garamond statements.' },
  { id: 'professional', name: 'Professional', blurb: 'Ivory ground, fine gold rules, quiet hierarchy.' },
  { id: 'retro', name: 'Retro', blurb: 'Nineties desktop: bevelled windows, navy title bars, yellow panels on teal.' },
  { id: 'sketch', name: 'Sketch', blurb: 'Warm working sheet, hand-drawn lines, pencil annotations.' },
  { id: 'monochrome', name: 'Monochrome', blurb: 'Pure black and white, oversized serif, square edges.' },
];

const KEY = 'lifedash-theme';
const STYLE_KEY = 'lifedash-style';
const META_COLORS: Record<StyleId, [string, string]> = {
  paper: ['#f7f7f4', '#111110'],
  terminal: ['#f2f5ef', '#0b0f0c'],
  editorial: ['#f6f0e4', '#1a1612'],
  soft: ['#f5f3fb', '#16151f'],
  contrast: ['#ffffff', '#000000'],
  nexus: ['#e8eaf6', '#0b0d1a'],
  compact: ['#f4f6f8', '#101418'],
  polar: ['#f6f9fc', '#0d1420'],
  'modern-dark': ['#f4f4f2', '#050505'],
  'playful-geometric': ['#fffdf5', '#1b1f2e'],
  cyberpunk: ['#eef4ef', '#020303'],
  luxury: ['#f3eee4', '#1b1815'],
  professional: ['#f7f4ec', '#191712'],
  retro: ['#008080', '#002b2b'],
  sketch: ['#f7f2e7', '#2b2822'],
  monochrome: ['#ffffff', '#000000'],
};

export function getTheme(): Theme {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* Use system when storage is blocked. */ }
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function getStyle(): StyleId {
  let v: string | null = null;
  try { v = localStorage.getItem(STYLE_KEY); } catch { /* Use Paper when storage is blocked. */ }
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

function renderTheme(t: Theme) {
  const dark =
    t === 'dark' ||
    (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  syncMeta();
}

export function applyTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  renderTheme(t);
}
export function applyStyle(s: StyleId) {
  localStorage.setItem(STYLE_KEY, s);
  document.documentElement.dataset.style = s;
  syncMeta();
}

export function cycleTheme(): Theme {
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getTheme()) + 1) % order.length];
  applyTheme(next);
  return next;
}

export function initTheme() {
  document.documentElement.dataset.style = getStyle();
  renderTheme(getTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') renderTheme('system');
  });
}
