import assert from "node:assert/strict";

import {
  WRITER_HEARTBEAT_MS,
  WRITER_LEASE_MS,
  claimWriterLease,
  leaseIsActive,
  readWriterLease,
  releaseWriterLease,
  renewWriterLease
} from "../lib/tabCoordinator.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
const start = 1_000_000;

assert.equal(claimWriterLease(storage, "tab-a", start), true);
assert.equal(readWriterLease(storage)?.tabId, "tab-a");
assert.equal(claimWriterLease(storage, "tab-b", start + 100), false);
assert.equal(releaseWriterLease(storage, "tab-b"), false);

assert.equal(
  renewWriterLease(storage, "tab-a", start + WRITER_HEARTBEAT_MS),
  true
);
const renewed = readWriterLease(storage);
assert.equal(renewed?.tabId, "tab-a");
assert.equal(
  renewed?.expiresAt,
  start + WRITER_HEARTBEAT_MS + WRITER_LEASE_MS
);
assert.equal(leaseIsActive(renewed, renewed.expiresAt - 1), true);
assert.equal(leaseIsActive(renewed, renewed.expiresAt), false);

assert.equal(
  claimWriterLease(storage, "tab-b", renewed.expiresAt),
  true
);
assert.equal(readWriterLease(storage)?.tabId, "tab-b");
assert.equal(renewWriterLease(storage, "tab-a", renewed.expiresAt), false);
assert.equal(releaseWriterLease(storage, "tab-b"), true);
assert.equal(readWriterLease(storage), null);

console.log(
  "多分頁租約測試通過：單一寫入者、心跳續租、逾時接手與安全釋放。"
);
