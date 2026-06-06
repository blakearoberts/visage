import {
  base64UrlToArrayBuffer,
  importKeyringFromCookie,
  type Keyring,
} from './keyring';

const StoreName = 'records';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CacheRecord = {
  readonly key: string;
  readonly kid: string;
  readonly iv: string;
  readonly ciphertext: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export class EncryptedStore {
  private db?: IDBDatabase;
  private keyring?: Keyring;
  private readonly ready: Promise<IDBDatabase>;

  private locked = false;

  constructor() {
    const request = indexedDB.open('visage-session-unlocked-store', 1);
    request.onupgradeneeded = ({ oldVersion }) => {
      const db = request.result;
      if (oldVersion < 1) {
        db.createObjectStore(StoreName, { keyPath: 'key' });
      }
    };
    const database = new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
    this.ready = Promise.all([
      database,
      importKeyringFromCookie().catch(() => undefined),
    ]).then(([db, keyring]) => {
      this.db = db;
      if (!this.locked) {
        this.keyring = keyring;
      }
      return db;
    });
  }

  lock() {
    this.locked = true;
    this.keyring = undefined;
  }

  async get<Data>(key: string): Promise<Data | undefined> {
    if (!this.db) this.db = await this.ready;
    const keyring = this.keyring;
    if (keyring === undefined) return undefined;

    const request = this.db
      .transaction(StoreName)
      .objectStore(StoreName)
      .get(key);

    const record = await new Promise<CacheRecord | undefined>(
      (resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    if (record === undefined) return undefined;

    const cacheKey =
      record.kid === keyring.current.kid
        ? keyring.current
        : record.kid === keyring.previous?.kid
          ? keyring.previous
          : undefined;
    if (cacheKey === undefined) return undefined;

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToArrayBuffer(record.iv) },
      cacheKey.key,
      base64UrlToArrayBuffer(record.ciphertext),
    );
    const data = JSON.parse(decoder.decode(plaintext)) as Data;
    if (record.kid !== keyring.current.kid) {
      await this.put(record.key, data);
    }
    return data;
  }

  async put<Data>(key: string, data: Data): Promise<void> {
    if (!this.db) this.db = await this.ready;
    const cacheKey = this.keyring?.current;
    if (cacheKey === undefined) return;

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cacheKey.key,
        encoder.encode(JSON.stringify(data)),
      ),
    );
    const request = this.db
      .transaction(StoreName, 'readwrite')
      .objectStore(StoreName)
      .put({
        key,
        kid: cacheKey.kid,
        iv: bytesToBase64Url(iv),
        ciphertext: bytesToBase64Url(ciphertext),
      });

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    if (!this.db) this.db = await this.ready;
    const request = this.db
      .transaction(StoreName, 'readwrite')
      .objectStore(StoreName)
      .delete(key);

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
