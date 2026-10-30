import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FONTS, WALLPAPERS, getFont, getWallpaper, applyFont, applyWallpaper, prepareWallpaper, wallpaperImage, type FontId, type WallpaperPrefs } from '../appearancePrefs';
import './PersonalizationControls.css';

export default function PersonalizationControls({section}:{section:'style'|'font'|'wallpaper'}) {
  const [font,setFont]=useState<FontId>(getFont);
  const [wallpaper,setWallpaper]=useState<WallpaperPrefs>(getWallpaper);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const imageGeneration=useRef(0);
  useEffect(()=>()=>{imageGeneration.current++;},[]);
  const chooseFont=(id:FontId)=>{try{applyFont(id);setFont(id);setError('');}catch{setError('Could not save this font on this device. Your previous choice is unchanged.');}};
  const chooseWallpaper=(p:WallpaperPrefs)=>{imageGeneration.current++;setBusy(false);try{applyWallpaper(p);setWallpaper(p);setError('');}catch{setError('Could not save this wallpaper. Free some browser storage or choose a smaller image. Your previous wallpaper is unchanged.');}};
  return <>
    <section role="tabpanel" id="appearance-section-font" hidden={section!=='font'} className="personalization-section" aria-labelledby="appearance-tab-font">
      <h3 id="appearance-font-heading">Font</h3>
      <p className="rule-note">Choose the font for all screens. Match style keeps each style's original type. Fonts are bundled, not loaded from another website.</p>
      <label className="field"><span>Interface font</span><select value={font} onChange={e=>chooseFont(e.target.value as FontId)}>{FONTS.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <div className="font-specimen" style={{fontFamily:FONTS.find(f=>f.id===font)?.family || 'var(--font)'}}>
        <strong>Make room for what matters.</strong><span>Review the week · 09:30 · 128 tasks</span><small>{FONTS.find(f=>f.id===font)?.description}</small>
      </div>
    </section>
    <section role="tabpanel" id="appearance-section-wallpaper" hidden={section!=='wallpaper'} className="personalization-section" aria-labelledby="appearance-tab-wallpaper">
      <h3 id="appearance-wallpaper-heading">Main-screen wallpaper</h3>
      <p className="rule-note">A subtle background behind your working screens. Text and controls keep solid surfaces. Saved only in this browser, not synced or included in exports.</p>
      <div className="wallpaper-choices" role="group" aria-label="Wallpaper presets">
        {WALLPAPERS.map(w=><button key={w.id} aria-pressed={wallpaper.id===w.id} className="wallpaper-choice" onClick={()=>chooseWallpaper({id:w.id,intensity:wallpaper.intensity})}><span style={{background:w.image||'var(--ground)'}} aria-hidden="true"/><strong>{w.name}</strong>{wallpaper.id===w.id && <span className="wallpaper-check" aria-hidden="true">✓</span>}</button>)}
      </div>
      {wallpaper.id==='custom' && <div className="wallpaper-local-preview" role="img" aria-label="Your selected local wallpaper" style={{backgroundImage:wallpaperImage(wallpaper)} as CSSProperties}/>}
      <div className="wallpaper-actions"><button className="btn-secondary" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Preparing image…':wallpaper.id==='custom'?'Replace image':'Choose image'}</button><button className="btn-secondary" disabled={wallpaper.id==='none'||busy} onClick={()=>chooseWallpaper({id:'none',intensity:20})}>Remove wallpaper</button></div>
      <input ref={input} className="wallpaper-file" type="file" aria-label="Wallpaper image file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const generation=++imageGeneration.current;setBusy(true);setError('');try{const image=await prepareWallpaper(file);if(generation!==imageGeneration.current)return;chooseWallpaper({id:'custom',image,intensity:wallpaper.intensity});}catch(error){if(generation===imageGeneration.current)setError(error instanceof Error?error.message:'Could not read this image.');}finally{if(generation===imageGeneration.current)setBusy(false);}}}/>
      <p className="rule-note">JPG, PNG or WebP, up to 10 MB and 40 megapixels. Images are resized to 1600 px, converted to JPEG and kept on this device. No image is uploaded.</p>
      <label className="wallpaper-intensity"><span>Wallpaper intensity <output>{wallpaper.intensity}%</output></span><input type="range" min="0" max="35" step="5" value={wallpaper.intensity} disabled={wallpaper.id==='none'||busy} onChange={e=>chooseWallpaper({...wallpaper,intensity:Number(e.target.value)})}/><small>Keep it subtle for clear text. Maximum 35%.</small></label>
    </section>
    {error && <p className="personalization-error" role="alert">{error}</p>}
  </>;
}
