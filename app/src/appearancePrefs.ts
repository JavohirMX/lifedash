export const FONTS = [
  { id: 'style', name: 'Match style', family: '', description: 'Keep each style’s original typography.' },
  { id: 'inter', name: 'Inter', family: "'Inter Variable', ui-sans-serif, system-ui, sans-serif", description: 'Clean, open shapes. A focused everyday choice.' },
  { id: 'manrope', name: 'Manrope', family: "'Manrope Variable', ui-sans-serif, system-ui, sans-serif", description: 'Rounded, geometric and a little more expressive.' },
  { id: 'geist', name: 'Geist', family: "'Geist Variable', ui-sans-serif, system-ui, sans-serif", description: 'Compact, crisp interface lettering.' },
  { id: 'source-sans', name: 'Source Sans 3', family: "'Source Sans 3 Variable', ui-sans-serif, system-ui, sans-serif", description: 'Open, humanist forms for longer reading.' },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans Variable', ui-sans-serif, system-ui, sans-serif", description: 'Softer geometric shapes with a friendly feel.' },
  { id: 'plex', name: 'IBM Plex Sans', family: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", description: 'The original Lifedash font.' },
  { id: 'system', name: 'System', family: 'ui-sans-serif, system-ui, -apple-system, sans-serif', description: 'Use your device’s own interface font.' },
  { id: 'serif', name: 'Serif', family: 'ui-serif, Georgia, serif', description: 'A book-like reading feel.' },
  { id: 'mono', name: 'Monospace', family: 'ui-monospace, SFMono-Regular, Consolas, monospace', description: 'Fixed-width letters and numbers.' },
] as const;
export type FontId = typeof FONTS[number]['id'];
const PREFIX = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sample') ? 'lifedash-sample-' : 'lifedash-';
export const FONT_KEY = `${PREFIX}font`;
export const WALLPAPER_KEY = `${PREFIX}wallpaper`;
export const WALLPAPERS = [
  { id: 'none', name: 'None', image: '' },
  { id: 'aurora', name: 'Aurora', image: 'radial-gradient(ellipse at 15% 10%, #6ee7b7, transparent 55%), radial-gradient(ellipse at 90% 90%, #a78bfa, transparent 60%), linear-gradient(135deg, #115e59, #312e81)' },
  { id: 'sand', name: 'Dunes', image: 'radial-gradient(ellipse at 20% 100%, #d6a06e 0%, transparent 65%), linear-gradient(25deg, #854d32, #f5dcc0 55%, #d2e4ea)' },
  { id: 'blue', name: 'Blue hour', image: 'radial-gradient(ellipse at 80% 0%, #7dd3fc, transparent 65%), linear-gradient(145deg, #172554, #3b5995 50%, #c4b5fd)' },
] as const;
export type WallpaperId = typeof WALLPAPERS[number]['id'] | 'custom';
export type WallpaperPrefs = { id: WallpaperId; intensity: number; image?: string };
const DEFAULT_WALLPAPER: WallpaperPrefs = {id:'none',intensity:20};
export function parseFont(value: string | null): FontId { return FONTS.some(f=>f.id===value) ? value as FontId : 'inter'; }
export function parseWallpaper(value: string | null): WallpaperPrefs {
  try {
    const p = JSON.parse(value ?? 'null');
    if (!p || ![...WALLPAPERS.map(w=>w.id),'custom'].includes(p.id)) return {...DEFAULT_WALLPAPER};
    if (p.id==='custom' && (typeof p.image!=='string' || p.image.length>900_000 || !/^data:image\/jpeg;base64,[a-zA-Z0-9+/]+=*$/.test(p.image))) return {...DEFAULT_WALLPAPER};
    return {id:p.id, intensity:typeof p.intensity==='number' && Number.isFinite(p.intensity) ? Math.max(0,Math.min(35,Math.round(p.intensity))) :20, ...(p.id==='custom'?{image:p.image}:{})};
  } catch {return {...DEFAULT_WALLPAPER};}
}
// Product decision 2026-10-27: Inter is the default font; the style's own
// typography renders only when the user explicitly picks "Match style".
export function getFont(): FontId {try{return parseFont(localStorage.getItem(FONT_KEY));}catch{return 'inter';}}
export function getWallpaper(): WallpaperPrefs {try{return parseWallpaper(localStorage.getItem(WALLPAPER_KEY));}catch{return {...DEFAULT_WALLPAPER};}}
function renderFont(id:FontId) {
  const font=FONTS.find(f=>f.id===id) ?? FONTS.find(f=>f.id==='inter')!;
  if(font.family) {document.documentElement.style.setProperty('--font',font.family);document.documentElement.style.setProperty('--font-display',font.family);}
  else {document.documentElement.style.removeProperty('--font');document.documentElement.style.removeProperty('--font-display');}
  document.documentElement.dataset.font=font.id;
}
export function applyFont(id:FontId) {
  // A failed user-initiated save keeps the previous rendered choice.
  localStorage.setItem(FONT_KEY,id);
  renderFont(id);
}
export function wallpaperImage(p:WallpaperPrefs):string {return p.id==='custom' && p.image ? `url("${p.image}")` : WALLPAPERS.find(w=>w.id===p.id)?.image ?? '';}
export function applyWallpaper(input:WallpaperPrefs) {
  const p=parseWallpaper(JSON.stringify(input));
  localStorage.setItem(WALLPAPER_KEY,JSON.stringify(p));
  document.documentElement.style.setProperty('--wallpaper-image',wallpaperImage(p)||'none');
  document.documentElement.style.setProperty('--wallpaper-intensity',String(p.intensity/100));
  document.documentElement.dataset.wallpaper=p.id;
}
export function initAppearancePrefs() {
  // Reading may be blocked. Render the approved fallback without needing a write.
  renderFont(getFont());
  try {applyWallpaper(getWallpaper());}catch {/* Keep safe wallpaper defaults. */}
}
export async function prepareWallpaper(file:File):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP image.');
  if(file.size>10*1024*1024)throw new Error('Choose an image smaller than 10 MB.');
  const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('This image could not be read. Try another file.');});
  try {
    if(bitmap.width*bitmap.height>40_000_000)throw new Error('Choose an image under 40 megapixels.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Image editing is unavailable in this browser.');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const image=canvas.toDataURL('image/jpeg',0.72);
    if(image.length>900_000)throw new Error('This image is too detailed to store locally. Try a smaller or simpler image.');
    return image;
  } finally {bitmap.close();}
}
