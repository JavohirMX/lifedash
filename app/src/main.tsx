import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initTheme } from './theme';
import { initAppearancePrefs } from './appearancePrefs';
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import '@fontsource-variable/geist';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/eb-garamond';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/caveat';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource-variable/host-grotesk';
import '@fontsource-variable/geist-mono';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/500-italic.css';
import '@fontsource-variable/eb-garamond/wght-italic.css';
import './styles.css';
import './personalization.css';
import './controls.css';

initTheme();
initAppearancePrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
