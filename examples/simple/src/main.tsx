import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionLockProvider } from '@blakearoberts/visage-react';

import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionLockProvider>
      <App />
    </SessionLockProvider>
  </StrictMode>,
);
