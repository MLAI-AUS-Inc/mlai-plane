import test from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.mjs";
const base = { LINEAR_API_KEY: "existing", PLANE_API_KEY: "plane", CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret", SYNC_STATE_DIR: "/tmp/mlai-sync-test" };
test("writeback uses the existing key when explicitly enabled", () => {
  assert.equal(config(base).linearWriteKey, null);
  assert.equal(config({ ...base, ENABLE_LINEAR_WRITEBACK: "true" }).linearWriteKey, "existing");
  assert.equal(config({ ...base, ENABLE_LINEAR_WRITEBACK: "true", LINEAR_WRITE_API_KEY: "dedicated" }).linearWriteKey, "dedicated");
});
