import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [whoami, setWhoami] = useState(null);

  async function loadWhoami() {
    setWhoami({ loading: true });

    try {
      const response = await fetch('/whoami/');
      const body = await response.text();

      setWhoami({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
    } catch (error) {
      setWhoami({ error: error.message });
    }
  }

  return (
    <>
      <h1>Hello from Visage</h1>
      <button onClick={loadWhoami}>Who are you?</button>
      {whoami && <pre>{JSON.stringify(whoami, null, 2)}</pre>}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
