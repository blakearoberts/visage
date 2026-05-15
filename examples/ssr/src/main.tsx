import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { App } from './App';

const identity = JSON.parse(
  document.getElementById('identity')?.textContent ?? '{}',
);

hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App identity={identity} />
  </StrictMode>,
);
