import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_ID, TARGET_ID, NAMESPACE } from "./config.mjs";
import { hash, pick, ISSUE_FIELDS } from "./model.mjs";
import { selections } from "./source.mjs";
export function bootstrap(store, exportDir, ledgerPath, destinationPath) {
  if (store.exists()) throw Error("Refusing to replace existing sync state");
  const manifest = JSON.parse(readFileSync(join(exportDir, "manifest.json"))),
    extras = JSON.parse(readFileSync(join(exportDir, "extras-manifest.json"))),
    ledger = JSON.parse(readFileSync(ledgerPath)),
    dest = JSON.parse(readFileSync(destinationPath));
  if (manifest.workspace.id !== SOURCE_ID || !ledger.completedAt) throw Error("Require completed MLAI import");
  const state = {
    version: 1,
    sourceId: SOURCE_ID,
    targetId: TARGET_ID,
    namespace: NAMESPACE,
    watermark: manifest.startedAt,
    data: {},
    projects: {},
    issues: {},
    comments: {},
    states: ledger.states,
    labels: ledger.labels,
    cycles: ledger.cycles,
    files: ledger.files,
    pending: {},
    intents: {},
    preservation: {},
    relations: Object.fromEntries(
      Object.entries(ledger.done)
        .filter(([k]) => k.startsWith("relation:"))
        .map(([k]) => [k.slice(9), true])
    ),
  };
  const metas = { ...manifest.collections, ...extras.collections };
  for (const root of Object.keys(selections)) {
    const rows = readdirSync(exportDir)
      .filter((n) => new RegExp("^" + root + "-\\d+\\.json$").test(n))
      .sort((a, b) => Number(a.match(/-(\d+)\.json$/)[1]) - Number(b.match(/-(\d+)\.json$/)[1]))
      .flatMap((n) => JSON.parse(readFileSync(join(exportDir, n)))[root].nodes);
    if (hash(rows) !== metas[root]?.sha256) throw Error("Source snapshot checksum mismatch: " + root);
    state.data[root] = Object.fromEntries(rows.map((r) => [r.id, r]));
    state.pending[root] = {};
  }
  if (dest.issues.filter((r) => state.data.issues[r.external_id]).length !== Object.keys(state.data.issues).length)
    throw Error("Incomplete destination baseline");
  state.issueCycles = Object.fromEntries(Object.values(state.data.issues).map((i) => [i.id, i.cycle?.id ?? null]));
  for (const [external, id] of Object.entries(ledger.projects)) {
    const source = state.data.projects[external];
    const row = dest.projects.find((p) => p.id === id);
    if (!row) throw Error("Missing baseline project");
    state.projects[external] = {
      id,
      last: {
        name: row.name,
        ...(source
          ? {
              description: `Original Linear project: ${source.name}\nSource ID: ${external}\n${source.description ?? ""}`,
            }
          : {}),
      },
      archived: !!row.archived_at,
    };
  }
  for (const [external, mapping] of Object.entries(ledger.issues)) {
    const row = dest.issues.find((r) => r.id === mapping.id);
    if (!row) throw Error("Missing baseline issue");
    const projected = {
      ...row,
      state: row.state_id,
      parent: row.parent_id,
      labels: dest.issue_labels.filter((l) => l.issue_id === row.id).map((l) => l.label_id),
      assignees: dest.issue_assignees.filter((a) => a.issue_id === row.id).map((a) => a.assignee_id),
    };
    state.issues[external] = { ...mapping, last: pick(projected, ISSUE_FIELDS) };
  }
  for (const [external, mapping] of Object.entries(ledger.comments)) {
    const row = dest.issue_comments.find((r) => r.id === mapping.id);
    if (!row) throw Error("Missing baseline comment");
    state.comments[external] = { ...mapping, last: pick(row, ["comment_html", "created_at"]) };
  }
  store.save(state);
  return {
    issues: Object.keys(state.data.issues).length,
    comments: Object.keys(state.comments).length,
    watermark: state.watermark,
  };
}
