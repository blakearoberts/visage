import useSWR, { mutate } from 'swr';

export function App() {
  const blob = useSWR<string>('/blob/text');
  return (
    <main>
      <header>
        <div>
          <h1>Session-unlocked SWR cache</h1>
          <p>Encrypted local data, live-session unlock, normal SWR truth.</p>
        </div>
        <button
          onClick={() => {
            void mutate(() => true, undefined, { revalidate: false });
            window.location.assign('/oauth2/sign_out');
          }}
        >
          Sign out
        </button>
      </header>
      <section>
        <button onClick={() => void blob.mutate()}>Refresh blob</button>
        {blob.error === undefined ? (
          <pre>{blob.data ?? 'Loading...'}</pre>
        ) : (
          <p>Unable to load the upstream blob.</p>
        )}
      </section>
    </main>
  );
}
