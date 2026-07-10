export function App() {
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
    </main>
  );
}
