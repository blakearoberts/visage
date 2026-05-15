import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { SWRConfig, mutate as mutateSWR } from 'swr';

export function SessionLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const queue = useRef(new Set<string>());

  useEffect(() => {
    const channel = new BroadcastChannel('session');
    channel.postMessage('ready');

    if (new URLSearchParams(window.location.search).has('reauth')) {
      channel.close();
      window.close();
      return;
    }

    channel.onmessage = () => {
      setLocked(false);
      for (const key of queue.current) mutateSWR(key);
      queue.current.clear();
    };
    return () => channel.close();
  }, []);

  return (
    <SWRConfig
      value={{
        isPaused: () => locked,
        fetcher: async (key: string) => {
          const response = await fetch(key);
          if (response.status === 401) throw response;
          const contentType = response.headers.get('content-type') ?? '';
          return /\bapplication\/json\b|\+json\b/i.test(contentType)
            ? await response.json()
            : await response.text();
        },
        onError: (error: unknown, key: string) => {
          if (error instanceof Response && error.status === 401) {
            queue.current.add(key);
            setLocked(true);
          }
        },
      }}
    >
      {children}
      {locked && <SessionLock />}
    </SWRConfig>
  );
}

function SessionLock() {
  function signBackIn() {
    window.open(`/oauth2/start?rd=${encodeURIComponent('/?reauth')}`);
  }
  return (
    <div
      style={{
        alignItems: 'center',
        background: 'white',
        display: 'grid',
        inset: 0,
        justifyItems: 'center',
        position: 'fixed',
        zIndex: 1,
      }}
    >
      <button onClick={signBackIn}>Sign back in</button>
    </div>
  );
}
