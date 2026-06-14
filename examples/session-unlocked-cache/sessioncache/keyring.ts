import {
  CacheKeyCookie,
  clearCacheKeyCookie,
  type CacheKeyCookiePayload,
  type CookieCacheKey,
} from './cookie';

export type CacheKey = {
  readonly kid: string;
  readonly key: CryptoKey;
};

export type Keyring = {
  readonly current: CacheKey;
  readonly previous: CacheKey | undefined;
};

export async function importKeyringFromCookie(): Promise<Keyring | undefined> {
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CacheKeyCookie}=`))
    ?.slice(CacheKeyCookie.length + 1);
  document.cookie = clearCacheKeyCookie();
  if (cookie === undefined) return undefined;

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(cookie)),
  ) as CacheKeyCookiePayload;
  if (payload.current === undefined) return undefined;

  return {
    current: await importCacheKey(payload.current),
    previous:
      payload.previous === undefined
        ? undefined
        : await importCacheKey(payload.previous),
  };
}

async function importCacheKey({ kid, key }: CookieCacheKey): Promise<CacheKey> {
  return {
    kid,
    key: await crypto.subtle.importKey(
      'raw',
      base64UrlToArrayBuffer(key),
      'AES-GCM',
      false,
      ['encrypt', 'decrypt'],
    ),
  };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64UrlToBytes(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}
