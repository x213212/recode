export const WRITER_LEASE_KEY =
  "recode-recall:writer-lease:v1";
export const WRITER_LEASE_MS = 6_000;
export const WRITER_HEARTBEAT_MS = 2_000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WriterLease {
  tabId: string;
  expiresAt: number;
}

export function parseWriterLease(value: string | null): WriterLease | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("tabId" in parsed) ||
      !("expiresAt" in parsed) ||
      typeof (parsed as WriterLease).tabId !== "string" ||
      !Number.isFinite((parsed as WriterLease).expiresAt)
    ) {
      return null;
    }
    return {
      tabId: (parsed as WriterLease).tabId,
      expiresAt: Number((parsed as WriterLease).expiresAt)
    };
  } catch {
    return null;
  }
}

export function readWriterLease(
  storage: KeyValueStorage
): WriterLease | null {
  return parseWriterLease(storage.getItem(WRITER_LEASE_KEY));
}

export function leaseIsActive(
  lease: WriterLease | null,
  now = Date.now()
): lease is WriterLease {
  return Boolean(lease && lease.expiresAt > now);
}

export function claimWriterLease(
  storage: KeyValueStorage,
  tabId: string,
  now = Date.now()
): boolean {
  const current = readWriterLease(storage);
  if (
    leaseIsActive(current, now) &&
    current.tabId !== tabId
  ) {
    return false;
  }

  storage.setItem(
    WRITER_LEASE_KEY,
    JSON.stringify({
      tabId,
      expiresAt: now + WRITER_LEASE_MS
    } satisfies WriterLease)
  );
  return readWriterLease(storage)?.tabId === tabId;
}

export function renewWriterLease(
  storage: KeyValueStorage,
  tabId: string,
  now = Date.now()
): boolean {
  const current = readWriterLease(storage);
  if (current?.tabId !== tabId) return false;

  storage.setItem(
    WRITER_LEASE_KEY,
    JSON.stringify({
      tabId,
      expiresAt: now + WRITER_LEASE_MS
    } satisfies WriterLease)
  );
  return true;
}

export function releaseWriterLease(
  storage: KeyValueStorage,
  tabId: string
): boolean {
  if (readWriterLease(storage)?.tabId !== tabId) return false;
  storage.removeItem(WRITER_LEASE_KEY);
  return true;
}
