import { describe,it,expect } from 'vitest';
import {parseFont,parseWallpaper} from './appearancePrefs';
describe('appearance preference validation',()=>{
 it('accepts known fonts and falls back without changing the default',()=>{expect(parseFont('inter')).toBe('inter');expect(parseFont('unknown')).toBe('style');expect(parseFont(null)).toBe('style');});
 it('clamps wallpaper intensity',()=>{expect(parseWallpaper('{"id":"blue","intensity":999}')).toEqual({id:'blue',intensity:35});expect(parseWallpaper('{"id":"blue","intensity":-1}').intensity).toBe(0);});
 it('rejects malformed and remote images',()=>{for(const value of ['bad','null','{"id":"unknown"}','{"id":"custom","image":"https://tracker.invalid/a.jpg"}','{"id":"custom","image":"data:image/svg+xml;base64,AAA"}'])expect(parseWallpaper(value).id).toBe('none');});
 it('accepts only bounded JPEG data for a custom wallpaper',()=>{expect(parseWallpaper('{"id":"custom","image":"data:image/jpeg;base64,AAAA","intensity":20}').id).toBe('custom');expect(parseWallpaper(JSON.stringify({id:'custom',image:'data:image/jpeg;base64,'+'A'.repeat(900000)})).id).toBe('none');});
});
