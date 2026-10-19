import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles.css';
import './responsive.css';
import './trace.css';
import './themes/palette.css';
import './themes/custom.css';
import { reloadThemes } from './themes/preferences';
import App from './App';
import { setLocale } from '../shared/i18n';
import { storage } from './storage';

setLocale(await storage.getLanguage());
await reloadThemes();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
