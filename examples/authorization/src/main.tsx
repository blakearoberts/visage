import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { App, type AuthorizationData } from './App';

const data = JSON.parse(
  document.querySelector('#authorization-data')?.textContent ?? '{}',
) as AuthorizationData;

hydrateRoot(
  document.querySelector('#root')!,
  <StrictMode>
    <App data={data} />
  </StrictMode>,
);
