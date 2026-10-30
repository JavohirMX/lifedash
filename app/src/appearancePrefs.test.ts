import { describe,it,expect,beforeEach } from 'vitest';
import {parseFont,parseWallpaper} from './appearancePrefs';
describe('appearance preference validation',()=>{
 it('accepts known fonts and uses Inter for missing or invalid preferences and preserves saved choices',()=>{expect(parseFont('inter')).toBe('inter');expect(parseFont('unknown')).toBe('inter');expect(parseFont(null)).toBe('inter');expect(parseFont('style')).toBe('style');expect(parseFont('geist')).toBe('geist');});
 it('clamps wallpaper intensity',()=>{expect(parseWallpaper('{"id":"blue","intensity":999}')).toEqual({id:'blue',intensity:35});expect(parseWallpaper('{"id":"blue","intensity":-1}').intensity).toBe(0);});
 it('rejects malformed and remote images',()=>{for(const value of ['bad','null','{"id":"unknown"}','{"id":"custom","image":"https://tracker.invalid/a.jpg"}','{"id":"custom","image":"data:image/svg+xml;base64,AAA"}'])expect(parseWallpaper(value).id).toBe('none');});
 it('accepts only bounded JPEG data for a custom wallpaper',()=>{expect(parseWallpaper('{"id":"custom","image":"data:image/jpeg;base64,AAAA","intensity":20}').id).toBe('custom');expect(parseWallpaper(JSON.stringify({id:'custom',image:'data:image/jpeg;base64,'+'A'.repeat(900000)})).id).toBe('none');});
});

describe('font rendering defaults', () => {
  const store = new Map<string, string>();
  const styleProps = new Map<string, string>();
  beforeEach(() => {
    store.clear(); styleProps.clear();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage;
    globalThis.document = {
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => void styleProps.set(k, v),
          removeProperty: (k: string) => void styleProps.delete(k),
        },
        dataset: {} as Record<string, string>,
      },
      querySelectorAll: () => [],
      createElement: () => ({ remove: () => {} }),
      head: { appendChild: () => {} },
    } as unknown as Document;
  });

  it('renders the style typography when no font was ever chosen', async () => {
    const { getFont, initAppearancePrefs } = await import('./appearancePrefs');
    expect(getFont()).toBe('style');
    initAppearancePrefs();
    expect(styleProps.has('--font')).toBe(false);
    expect(styleProps.has('--font-display')).toBe(false);
    expect(document.documentElement.dataset.font).toBe('style');
  });

  it('keeps an explicit saved font pinned across styles', async () => {
    const { applyFont, initAppearancePrefs, FONT_KEY } = await import('./appearancePrefs');
    applyFont('geist');
    expect(store.get(FONT_KEY)).toBe('geist');
    expect(styleProps.get('--font')).toContain('Geist Variable');
    initAppearancePrefs();
    expect(styleProps.get('--font')).toContain('Geist Variable');
    applyFont('style');
    expect(styleProps.has('--font')).toBe(false);
    expect(document.documentElement.dataset.font).toBe('style');
  });
});
