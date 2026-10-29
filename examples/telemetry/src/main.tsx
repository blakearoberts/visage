import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionLockProvider } from '@blakearoberts/visage-react';

import { App } from './App';
import { createConsoleInstrumentation } from './telemetry/instrumentation/console';
import { createWebVitalsInstrumentation } from './telemetry/instrumentation/web-vitals';
import {
  BatchLogRecordProcessor,
  createLoggerProvider,
  OTLPHTTPJSONExporter,
  setGlobalLoggerProvider,
} from './telemetry/log';

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
createWebVitalsInstrumentation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionLockProvider>
      <App />
    </SessionLockProvider>
  </StrictMode>,
);
