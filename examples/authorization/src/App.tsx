import { Fragment } from 'react';

export type AuthorizationData = {
  readonly requestedScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly user: {
    readonly subject: string;
    readonly email?: string;
    readonly name?: string;
  };
  readonly delegation: {
    readonly audience: string;
    readonly actor: string;
    readonly clientId: string;
  };
};

export function App({ data }: { readonly data: AuthorizationData }) {
  const rows = [
    ['Requested scopes', data.requestedScopes.join(' ')],
    ['Granted scopes', data.grantedScopes.join(' ')],
    ['User subject', data.user.subject],
    ['User email', data.user.email ?? ''],
    ['User name', data.user.name ?? ''],
    ['Resource audience', data.delegation.audience],
    ['Actor', data.delegation.actor],
    ['Client ID', data.delegation.clientId],
  ] as const;

  function signOut() {
    window.location.assign('/oauth2/sign_out');
  }

  return (
    <main
      style={{ margin: '0 auto', maxWidth: 'min(760px, calc(100% - 2rem))' }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1>Visage delegated authorization</h1>
        <p>Dex identity, RFC 8693 token exchange, and OPA scope attenuation.</p>
        <button onClick={signOut}>Sign out</button>
      </div>

      <dl
        data-test-id='authorization-data'
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          columnGap: '1rem',
        }}
      >
        {rows.map(([name, value]) => (
          <Fragment key={name}>
            <dt style={{ fontWeight: 'bold', textAlign: 'right' }}>{name}:</dt>
            <dd data-field={name}>{value}</dd>
          </Fragment>
        ))}
      </dl>
    </main>
  );
}
