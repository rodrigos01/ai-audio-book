import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { DownloadsProvider } from './context/DownloadsContext'
import { hasActiveDownloads } from './lib/activeDownloads'

registerSW({
  immediate: true,
  // Default autoUpdate behavior reloads the page the instant a new service
  // worker activates, which would silently abort an in-progress chapter
  // download. Wait until no downloads are active before reloading.
  onNeedReload: () => {
    const reloadWhenIdle = () => {
      if (hasActiveDownloads()) {
        setTimeout(reloadWhenIdle, 2000);
      } else {
        window.location.reload();
      }
    };
    reloadWhenIdle();
  }
})

// Import Material Web Components to register them
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/textfield/filled-text-field.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/iconbutton/filled-icon-button.js';
import '@material/web/iconbutton/outlined-icon-button.js';
import '@material/web/divider/divider.js';
import '@material/web/progress/linear-progress.js';
import '@material/web/progress/circular-progress.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/slider/slider.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/switch/switch.js';
import '@material/web/fab/fab.js';
import '@material/web/dialog/dialog.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/text-button.js';

console.log('main.jsx: Starting React initialization...');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <DownloadsProvider>
        <App />
      </DownloadsProvider>
    </AuthProvider>
  </StrictMode>,
)
