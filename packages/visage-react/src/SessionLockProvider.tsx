import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SWRConfig, mutate } from 'swr';

class FetchError extends Error {
  constructor(
    readonly response: Response,
    readonly epoch: number,
  ) {
    super(`HTTP ${response.status} ${response.statusText}`);
  }
}

export function SessionLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const queue = useRef(new Set<string>()); // queue 401s until re-login
  const epoch = useRef(0); // counter for stale-401 detection to avoid dup-lock

  useEffect(() => {
    const channel = new BroadcastChannel('session');
    channel.postMessage('ready'); // all page loads constitute a ready session

    if (new URLSearchParams(window.location.search).has('reauth')) {
      // immediately close re-login pop-up windows
      channel.close();
      window.close();
      return;
    }

    // flush 401 queue on session ready signal
    channel.onmessage = () => {
      epoch.current += 1;
      const keys = [...queue.current];
      queue.current.clear();
      setLocked(false);
      for (const key of keys) {
        // trigger revalidation for mounted hooks with matching keys
        mutate(key);
      }
    };
    return () => channel.close();
  }, []);

  return (
    <SWRConfig
      value={{
        fetcher: async (key: string) => {
          const startedAt = epoch.current;
          const response = await fetch(key);
          if (!response.ok) throw new FetchError(response, startedAt);
          const contentType = response.headers.get('content-type') ?? '';
          return /\bapplication\/json\b|\+json\b/i.test(contentType)
            ? await response.json()
            : await response.text();
        },
        onError: (error: unknown, key: string) => {
          if (!(error instanceof FetchError)) return; // ignore unknown errors
          if (error.response.status !== 401) return; // ignore non-401
          if (error.epoch !== epoch.current) return; // ignore stale 401
          queue.current.add(key);
          setLocked(true);
        },
        // 401s are recovered through the session lock, not SWR's retry loop.
        // Other errors keep SWR's default retry behavior.
        shouldRetryOnError: (error: unknown) =>
          !(error instanceof FetchError && error.response.status === 401),
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
