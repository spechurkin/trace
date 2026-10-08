import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles.css';
import './responsive.css';
import './trace.css';
import App from './App';
import { setLocale } from '../shared/i18n';
import { storage } from './storage';

setLocale(await storage.getLanguage());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
