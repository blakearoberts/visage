import { Fragment, useMemo } from 'react';
import useSWR from 'swr';

function useSsrIdentity(identity: Record<string, unknown>) {
  return useMemo(
    () =>
      Object.entries(identity).map(([name, value]): [string, string] => [
        name,
        String(value),
      ]),
    [],
  );
}

function useCsrIdentity() {
  const { data: whoami } = useSWR('/whoami/', (url) =>
    fetch(url).then((response) => response.text()),
  );
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

export function App({ identity }: { identity: Record<string, unknown> }) {
  const ssrIdentity = useSsrIdentity(identity);
  const csrIdentity = useCsrIdentity();

  function signOut() {
    window.location.assign('/oauth2/sign_out?rd=%2F');
  }

  return (
    <main
      style={{ margin: '0 auto', maxWidth: 'min(760px, calc(100% - 2rem))' }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1>Hello from Visage</h1>
        <button onClick={signOut}>Sign out</button>
      </div>

      <h2>SSR Identity</h2>
      <IdentityPre testId='ssr-identity' rows={ssrIdentity} />

      <h2>CSR Identity</h2>
      <IdentityPre testId='csr-identity' rows={csrIdentity} />
    </main>
  );
}

function IdentityPre({
  rows,
  testId,
}: {
  rows: readonly (readonly [name: string, value: string])[];
  testId: string;
}) {
  return (
    <pre
      data-test-id={testId}
      style={{
        textWrap: 'pretty',
        overflowWrap: 'anywhere',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        columnGap: '1rem',
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
}
