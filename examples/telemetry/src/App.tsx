import { useState } from 'react';

export function App() {
  const [whoami, setWhoami] = useState<string>();

  async function fetchWhoami() {
    try {
      const response = await fetch('/whoami/');
      setWhoami(await response.text());
    } catch (error) {
      setWhoami(String(error));
    }
  }

  function signOut() {
    window.location.assign('/oauth2/sign_out');
  }

  return (
    <main
      style={{ margin: '0 auto', maxWidth: 'min(760px, calc(100% - 2rem))' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
        }}
      >
        <h1 style={{ gridColumn: 2 }}>Hello from Visage</h1>
        <button style={{ justifySelf: 'end' }} onClick={signOut}>
          Sign out
        </button>
      </div>
      <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center' }}>
        <div>
          Visage dashboard
          <ul>
            <li>
              <a href='/grafana/d/visage?dtab=Browser'>Browser</a>
            </li>
            <li>
              <a href='/grafana/d/visage?dtab=Ingress'>Ingress</a>
            </li>
            <li>
              <a href='/grafana/d/visage?dtab=OAuth'>OAuth</a>
            </li>
          </ul>
        </div>
        <div>
          Grafana Drilldown
          <ul>
            <li>
              <a href='/grafana/a/grafana-lokiexplore-app'>Logs</a>
            </li>
            <li>
              <a href='/grafana/a/grafana-metricsdrilldown-app'>Metrics</a>
            </li>
            <li>
              <a href='/grafana/a/grafana-exploretraces-app'>Traces</a>
            </li>
          </ul>
        </div>
      </div>
      <hr />
      <button onClick={fetchWhoami}>Who am I?</button>
      {whoami !== undefined && (
        <pre style={{ overflowX: 'scroll' }}>{whoami}</pre>
      )}
    </main>
  );
}
