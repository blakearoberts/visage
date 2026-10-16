import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App, type AuthorizationData } from './App';

export function render(data: AuthorizationData): string {
  return renderToString(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  );
}
