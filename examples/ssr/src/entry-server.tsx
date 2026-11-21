import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App } from './App.tsx';

export function render(identity: Record<string, unknown>) {
  return renderToString(
    <StrictMode>
      <App identity={identity} />
    </StrictMode>,
  );
}
