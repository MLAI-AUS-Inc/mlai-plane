import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
export const SOURCE_ID = "cecd4ea8-59f4-4094-892f-d1e71da72327";
export const TARGET_ID = "8dad3148-2976-4e3c-8456-fb62cfe44138";
export const NAMESPACE = "linear-mlai-20260907";
export const PUBLIC_URL = "https://plane.mlai.au";
export const API_ORIGIN = "https://plane-origin-staging.mlai.au";
export const ROOT = "/api/v1/workspaces/mlai/projects/";
export function readEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (!value.endsWith(value[0])) throw Error("Invalid env quoting");
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, "");
    env[m[1]] = value;
  }
  return env;
}
export function config(env = process.env) {
  for (const key of [
    "LINEAR_API_KEY",
    "PLANE_API_KEY",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "SYNC_STATE_DIR",
  ])
    if (!env[key]) throw Error("Missing configuration: " + key);
  if (!isAbsolute(env.SYNC_STATE_DIR)) throw Error("SYNC_STATE_DIR must be absolute");
  return {
    linearKey: env.LINEAR_API_KEY,
    linearWriteKey: env.LINEAR_WRITE_API_KEY || (env.ENABLE_LINEAR_WRITEBACK === "true" ? env.LINEAR_API_KEY : null),
    writeBack: env.ENABLE_LINEAR_WRITEBACK === "true",
    planeKey: env.PLANE_API_KEY,
    cfId: env.CF_ACCESS_CLIENT_ID,
    cfSecret: env.CF_ACCESS_CLIENT_SECRET,
    stateDir: resolve(env.SYNC_STATE_DIR),
  };
}
