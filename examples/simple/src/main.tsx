import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { SessionLockProvider } from './SessionLockProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionLockProvider>
      <App />
    </SessionLockProvider>
  </StrictMode>,
);
