import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mutate, SWRConfig } from 'swr';

import { App } from './App';
import { EncryptedStore } from '../sessioncache/store';

const store = new EncryptedStore();

async function fetcher(key: string) {
  const fresh = fetch(key)
    .then((res) => {
      if (res.status === 401) {
        store.lock();
        void mutate(() => true, undefined, { revalidate: false });
        throw new Error('Unauthorized');
      }
      if (!res.ok) throw new Error(res.statusText);
      const text = res.text();

      // always cache fresh data to memory
      mutate(key, text, { revalidate: false });
      return text;
    })
    .then((data) => {
      // always cache fresh data to disk
      store.put(key, data);
      return data;
    });

  const cached = store
    .get<string>(key)
    .then((data) => data ?? Promise.reject());

  // the race is off; the first one wins
  return Promise.any([fresh, cached]);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SWRConfig value={{ fetcher }}>
      <App />
    </SWRConfig>
  </StrictMode>,
);
