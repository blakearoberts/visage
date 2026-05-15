import { Fragment } from 'react';
import useSWR from 'swr';

function useWhoami() {
  const { data: whoami } = useSWR<string>('/whoami/');
  return (
    whoami
      ?.split('\n')
      .filter((line) => line.trim().length !== 0)
      .map((line): [string, string] => {
        const [name, value] = line.split(':', 2);
        if (value === undefined) return ['Request', name];
        return [name, value.trim()];
      }) ?? []
  );
}

const IdentityPre: React.FC<{
  rows: [name: string, value: string][];
}> = ({ rows }) => {
  return (
    <pre
      style={{
        textWrap: 'pretty',
        overflowWrap: 'anywhere',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        columnGap: '1rem',
        margin: '1rem auto 0',
        maxWidth: 'min(72rem, 80vw)',
        textAlign: 'left',
      }}
    >
      {rows.map(([name, value], i) => (
        <Fragment key={i}>
          <div style={{ fontWeight: 'bold', textAlign: 'right' }}>{name}:</div>
          <div>{value}</div>
        </Fragment>
      ))}
    </pre>
  );
};

export function App() {
  const rows = useWhoami();

  function signOut() {
    window.location.assign('/oauth2/sign_out');
  }

  return (
    <main
      style={{ margin: '0 auto', maxWidth: 'min(760px, calc(100% - 2rem))' }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1>Hello from Visage</h1>
        <button onClick={signOut}>Sign out</button>
      </div>

      <h2>/whoami/</h2>
      <IdentityPre rows={rows} />
    </main>
  );
}
