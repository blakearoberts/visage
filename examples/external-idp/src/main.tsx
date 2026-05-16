import { Fragment, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

type WhoamiState =
  | null
  | { loading: true; body?: never; error?: never }
  | { body: string; loading?: never; error?: never }
  | { error: string; loading?: never; body?: never };

function App() {
  const [whoami, setWhoami] = useState<WhoamiState>(null);

  async function loadWhoami() {
    setWhoami({ loading: true });

    try {
      const response = await fetch('/whoami/');
      const body = await response.text();

      setWhoami({ body });
    } catch (error) {
      setWhoami({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function signOut() {
    window.location.assign('/oauth2/sign_out');
  }

  return (
    <main style={{ padding: '1rem', textAlign: 'center' }}>
      <h1>Hello from Visage</h1>
      <button onClick={loadWhoami}>Who am I?</button>
      <button onClick={signOut}>Sign out</button>
      {whoami?.loading && <p>Loading...</p>}
      {whoami?.error && <p role='alert'>{whoami.error}</p>}
      {whoami?.body && (
        <div
          aria-label='Whoami response body'
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content minmax(0, 1fr)',
            gap: '0.125rem 1rem',
            margin: '1rem auto 0',
            maxWidth: 'min(72rem, 80vw)',
            textAlign: 'left',
            width: '100%',
          }}
        >
          {whoami.body.split('\n').map((line, index) => {
            const i = line.indexOf(':');
            const row =
              i === -1
                ? { name: 'Request', value: line }
                : { name: line.slice(0, i), value: line.slice(i + 1) };

            return (
              <Fragment key={`${row.name}-${index}`}>
                <div style={{ fontWeight: 600, textAlign: 'right' }}>
                  {row.name}
                </div>
                <div
                  style={{
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'normal',
                  }}
                >
                  {row.value}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
