import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

import { getGlobalLoggerProvider } from '../log';

export function createWebVitalsInstrumentation(): void {
  const logger = getGlobalLoggerProvider().logger('web-vitals');

  function report(metric: Metric): void {
    logger.emit({
      timestamp: performance.timeOrigin + performance.now(),
      severityNumber: 5,
      severityText: 'DEBUG',
      eventName: 'browser.web_vital',
      body: `${metric.name}: ${metric.value}`,
      attributes: {
        ...(metric.navigationURL !== undefined
          ? { 'url.full': metric.navigationURL }
          : {}),
        'browser.web_vital.name': metric.name.toLowerCase(),
        'browser.web_vital.value': metric.value,
        'browser.web_vital.delta': metric.delta,
        'browser.web_vital.id': metric.id,
        'browser.web_vital.rating': metric.rating,
        'browser.web_vital.navigation_type': metric.navigationType,
      },
    });
  }

  onCLS(report, { reportSoftNavs: true });
  onFCP(report, { reportSoftNavs: true });
  onINP(report, { reportSoftNavs: true });
  onLCP(report, { reportSoftNavs: true });
  onTTFB(report);
}
