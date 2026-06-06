export const CacheKeyCookie = 'visage_cache_keyring';

export type CookieCacheKey = {
  readonly kid: string;
  readonly key: string;
};

export type CacheKeyCookiePayload = {
  readonly current?: CookieCacheKey;
  readonly previous?: CookieCacheKey;
};

const CacheKeyCookieAttributes = 'Path=/; Secure; SameSite=Lax';
const CacheKeyCookieMaxAgeSeconds = 10;

export function cacheKeyCookie(value: string): string {
  return `${CacheKeyCookie}=${value}; ${CacheKeyCookieAttributes}; Max-Age=${CacheKeyCookieMaxAgeSeconds}`;
}

export function clearCacheKeyCookie(): string {
  return `${CacheKeyCookie}=; ${CacheKeyCookieAttributes}; Max-Age=0`;
}
