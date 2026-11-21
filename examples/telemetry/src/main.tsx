import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionLockProvider } from '@blakearoberts/visage-react';

import { App } from './App.tsx';
import { createConsoleInstrumentation } from './telemetry/instrumentation/console.ts';
import { createHTTPInstrumentation } from './telemetry/instrumentation/http.ts';
import { createWebVitalsInstrumentation } from './telemetry/instrumentation/web-vitals.ts';
import {
  BatchLogRecordProcessor,
  createLoggerProvider,
  OTLPHTTPJSONExporter,
  setGlobalLoggerProvider,
} from './telemetry/log/index.ts';

setGlobalLoggerProvider(
  createLoggerProvider(
    {
      attributes: {
        'service.name': 'browser',
        'service.namespace': 'visage-example-telemetry',
      },
    },
    new BatchLogRecordProcessor(new OTLPHTTPJSONExporter('/t/v1/logs')),
  ),
);
createConsoleInstrumentation();
createHTTPInstrumentation();
createWebVitalsInstrumentation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionLockProvider>
      <App />
    </SessionLockProvider>
  </StrictMode>,
);
