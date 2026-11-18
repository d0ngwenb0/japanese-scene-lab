import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      if (navigator.onLine) {
        registration.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    });
    window.addEventListener('focus', checkForUpdate);
    window.addEventListener('online', checkForUpdate);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
