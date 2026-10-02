import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');

// Register after the initial page finishes loading so cache warming never
// competes with the first render. A failure leaves normal network loading intact.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'admin-static-cache-hit') {
      console.debug('后台静态缓存命中', event.data.path);
    }
  });
  const register = () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}asset-worker.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none'
    }).then(() => navigator.serviceWorker.ready).then(() => {
      console.debug('后台静态缓存已启用');
    }).catch(() => {});
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
