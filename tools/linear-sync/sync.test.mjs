import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "./engine.mjs";
import { Plane } from "./plane.mjs";
import { Linear, selections } from "./source.mjs";
import { Store } from "./store.mjs";
import { ROOT, NAMESPACE, SOURCE_ID, TARGET_ID } from "./config.mjs";
import { mergeFields, normalizeHtml, cycleDate } from "./model.mjs";
import { plist } from "./schedule.mjs";

test("local schedule uses five minutes and explicit apply with XML-safe paths", () => {
  const xml = plist({
    node: "/usr/bin/node",
    cli: "/a&b/cli.mjs",
    env: "/private/sync.env",
    stateDir: "/private/state",
  });
  assert.match(xml, /<key>StartInterval<\/key><integer>300<\/integer>/);
  assert.match(xml, /<string>--apply<\/string>/);
  assert.match(xml, /a&amp;b/);
  assert.ok(!xml.includes("LINEAR_API_KEY"));
});

test("new cycle drafts are not mistaken for edits to an existing cycle", async () => {
  const engine = Object.create(Engine.prototype);
  engine.state = { cycles: { "p:c": "target" }, cycleDrafts: { "p:c": { id: "target" } } };
  await engine.process("cycles", { id: "c" });
  engine.state.cycleDrafts = {};
  await assert.rejects(engine.process("cycles", { id: "c" }), /Existing cycle metadata changed/);
});

function fixture() {
  const roots = () => Object.fromEntries(Object.keys(selections).map((k) => [k, {}]));
  const source = {
    ...roots(),
    teams: { t: { id: "t", name: "Test", private: false, updatedAt: "2026-01-01" } },
    users: { u: { id: "u", name: "Tester", email: "test@example.invalid", active: true, updatedAt: "2026-01-01" } },
    projects: { p: { id: "p", name: "Test", description: "", updatedAt: "2026-01-01" } },
    workflowStates: { s: { id: "s", name: "Todo", type: "unstarted", color: "#fff", updatedAt: "2026-01-01" } },
  };
  const state = {
    version: 1,
    sourceId: SOURCE_ID,
    targetId: TARGET_ID,
    namespace: NAMESPACE,
    watermark: "2026-01-01T00:00:00Z",
    lastReconcile: "2026-01-01T00:00:00Z",
    data: structuredClone(source),
    pending: roots(),
    projects: {
      archive: { id: "a", last: { name: "Archive" } },
      p: {
        id: "p",
        last: { name: "Test", description: "Original Linear project: Test\nSource ID: p\n" },
        archived: false,
      },
    },
    issues: {},
    comments: {},
    states: { "p:s": "s" },
    labels: {},
    cycles: {},
    issueCycles: {},
    relations: {},
    files: {},
    intents: {},
  };
  const db = {
    issues: {},
    comments: {},
    projects: {
      a: { id: "a", name: "Archive", workspace: TARGET_ID, external_source: NAMESPACE, external_id: "archive" },
      p: {
        id: "p",
        name: "Test",
        description: state.projects.p.last.description,
        workspace: TARGET_ID,
        external_source: NAMESPACE,
        external_id: "p",
      },
    },
  };
  const writes = [];
  let lost = false;
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname,
      query = new URL(url).searchParams,
      method = init.method;
    const body = init.body ? JSON.parse(init.body) : null;
    const response = (x, status = 200) => new Response(JSON.stringify(x), { status });
    if (path === "/api/v1/users/me/") return response({ id: "u", email: "test@example.invalid" });
    if (path === ROOT) return response(Object.values(db.projects));
    const tail = path.slice(ROOT.length).split("/").filter(Boolean),
      project = tail[0];
    if (tail.length === 1) return response(db.projects[project]);
    if (tail[1] === "work-items") {
      const comments = tail[3] === "comments",
        table = comments ? db.comments : db.issues,
        id = comments ? tail[4] : tail[2];
      if (method === "GET") {
        if (id) return table[id] && !table[id].archived_at ? response(table[id]) : response({}, 404);
        if (query.has("external_id")) {
          const row = Object.values(table).find((r) => r.external_id === query.get("external_id"));
          return row ? response(row) : response({}, 404);
        }
        return response(Object.values(table));
      }
      writes.push({ method, path, body });
      if (method === "POST") {
        const key = "target-" + (Object.keys(table).length + 1);
        table[key] = { id: key, project, workspace: TARGET_ID, ...body };
        if (lost) {
          lost = false;
          throw Error("Simulated response loss");
        }
        return response(table[key], 201);
      }
      if (method === "PATCH") {
        Object.assign(table[id], body);
        return response(table[id]);
      }
    }
    throw Error("Unhandled fake endpoint " + method + " " + path);
  };
  const store = {
    save: (s) => {
      store.saved = structuredClone(s);
      store.count++;
    },
    count: 0,
  };
  const linear = { identity: async () => {}, collection: async (root) => structuredClone(Object.values(source[root])) };
  const run = async (apply = true) => {
    const plane = new Plane({ planeKey: "test", cfId: "test", cfSecret: "test" }, { apply, fetcher, pace: 0 });
    const engine = new Engine({ state, store, linear, plane, apply, now: () => new Date("2026-01-01T01:00:00Z") });
    return engine.run();
  };
  const add = () => {
    source.issues.i = {
      id: "i",
      identifier: "T-1",
      title: "Original",
      description: "Hello",
      url: "https://linear.app/test/T-1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:30:00Z",
      project: { id: "p" },
      team: { id: "t" },
      state: { id: "s" },
      priority: 0,
      assignee: { id: "u" },
      creator: { id: "u" },
      labelIds: [],
      cycle: null,
      parent: null,
    };
    return source.issues.i;
  };
  return {
    source,
    state,
    db,
    writes,
    store,
    linear,
    run,
    add,
    loseResponse: () => {
      lost = true;
    },
  };
}
test("a failed source collection prevents all destination writes and watermark advance", async () => {
  const f = fixture();
  f.add();
  const watermark = f.state.watermark;
  const collection = f.linear.collection;
  f.linear.collection = async (root) => {
    if (root === "projectUpdates") throw Error("Simulated source outage");
    return collection(root);
  };
  await assert.rejects(f.run(), /Simulated source outage/);
  assert.equal(f.state.watermark, watermark);
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.count, 0);
});
test("dry run plans new issue/comment without writes or checkpoints", async () => {
  const f = fixture();
  f.add();
  f.source.comments.c = {
    id: "c",
    body: "Comment",
    issue: { id: "i" },
    user: { id: "u" },
    createdAt: "2026-01-01T00:01:00Z",
    updatedAt: "2026-01-01T00:30:00Z",
  };
  const r = await f.run(false);
  assert.equal(r.creates, 2);
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.count, 0);
});
test("creates issue/comment once and remains idempotent on repeat", async () => {
  const f = fixture();
  f.add();
  f.source.comments.c = {
    id: "c",
    body: "Comment",
    issue: { id: "i" },
    user: { id: "u" },
    createdAt: "2026-01-01T00:01:00Z",
    updatedAt: "2026-01-01T00:30:00Z",
  };
  assert.equal((await f.run()).creates, 2);
  assert.equal((await f.run()).creates, 0);
  assert.equal(f.writes.length, 2);
});
test("archived issue creation and later reads use external identity", async () => {
  const f = fixture(),
    issue = f.add();
  issue.archivedAt = "2026-01-01T00:31:00Z";
  assert.equal((await f.run()).creates, 1);
  issue.title = "Updated archived issue";
  issue.updatedAt = "2026-01-01T00:40:00Z";
  const report = await f.run();
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.updates, 1);
  assert.equal(f.db.issues["target-1"].name, "[T-1] Updated archived issue");
  assert.equal(f.writes.length, 2);
});
test("updates source changes and verifies saved content", async () => {
  const f = fixture(),
    i = f.add();
  await f.run();
  i.title = "Updated";
  i.updatedAt = "2026-01-01T00:40:00Z";
  const r = await f.run();
  assert.equal(r.updates, 1);
  assert.equal(f.db.issues["target-1"].name, "[T-1] Updated");
});
test("conflicting Plane edit is retained and source change stays pending", async () => {
  const f = fixture(),
    i = f.add();
  await f.run();
  f.db.issues["target-1"].name = "Human edit";
  i.title = "Source edit";
  i.updatedAt = "2026-01-01T00:40:00Z";
  const r = await f.run();
  assert.equal(r.conflicts.length, 1);
  assert.equal(f.db.issues["target-1"].name, "Human edit");
  assert.ok(f.state.pending.issues.i);
  assert.equal((await f.run()).conflicts.length, 1);
});
test("unrelated Plane edit survives source title update", async () => {
  const f = fixture(),
    i = f.add();
  await f.run();
  f.db.issues["target-1"].priority = "high";
  i.title = "Source edit";
  i.updatedAt = "2026-01-01T00:40:00Z";
  assert.equal((await f.run()).conflicts.length, 0);
  assert.equal(f.db.issues["target-1"].priority, "high");
});
test("lost create response reconciles without duplicate POST", async () => {
  const f = fixture();
  f.add();
  f.loseResponse();
  await assert.rejects(f.run(), /Ambiguous Plane write/);
  assert.equal(f.writes.length, 1);
  await f.run();
  assert.equal(f.writes.length, 1);
  assert.equal(Object.keys(f.db.issues).length, 1);
});
test("deleted target is flagged, never recreated", async () => {
  const f = fixture(),
    i = f.add();
  await f.run();
  delete f.db.issues["target-1"];
  i.updatedAt = "2026-01-01T00:40:00Z";
  assert.equal((await f.run()).conflicts.length, 1);
  assert.equal(f.writes.length, 1);
});
test("private source team fails before any writes", async () => {
  const f = fixture();
  f.add();
  f.source.teams.t.private = true;
  await assert.rejects(f.run(), /visibility/);
  assert.equal(f.writes.length, 0);
});
test("source disappearance during reconciliation never deletes destination", async () => {
  const f = fixture();
  f.add();
  await f.run();
  delete f.source.issues.i;
  f.state.lastReconcile = null;
  const r = await f.run();
  assert.ok(r.conflicts.some((c) => c.reason.includes("Source missing")));
  assert.equal(Object.keys(f.db.issues).length, 1);
});
test("source mutation/subscription rejected without network call", async () => {
  let calls = 0;
  const c = new Linear("test", async () => {
    calls++;
  });
  await assert.rejects(c.query("mutation Sync { x }"), /read-only/);
  await assert.rejects(c.query("subscription Sync { x }"), /read-only/);
  assert.equal(calls, 0);
});
test("source pagination includes every page and rejects partial GraphQL data", async () => {
  let calls = 0;
  const c = new Linear("test", async (url, options) => {
    assert.equal(url, "https://api.linear.app/graphql");
    assert.equal(options.redirect, "error");
    const after = JSON.parse(options.body).variables.after;
    calls++;
    return new Response(
      JSON.stringify({
        data: {
          issues: { nodes: [{ id: after ? "2" : "1" }], pageInfo: { hasNextPage: !after, endCursor: "cursor" } },
        },
      })
    );
  });
  assert.deepEqual(
    (await c.collection("issues", "2026-01-01")).map((r) => r.id),
    ["1", "2"]
  );
  assert.equal(calls, 2);
  const broken = new Linear(
    "test",
    async () => new Response(JSON.stringify({ data: { issues: {} }, errors: [{ message: "partial" }] }))
  );
  await assert.rejects(broken.collection("issues", "2026-01-01"), /query failed/);
});
test("Plane guard refuses deletion, dry writes and unrelated projects", async () => {
  const p = new Plane({}, { apply: true, pace: 0 });
  await assert.rejects(p.request("DELETE", ROOT + "x/"), /not allowed/);
  await assert.rejects(p.request("PATCH", ROOT + "x/", {}), /verified/);
  await assert.rejects(new Plane({}).request("POST", ROOT, {}), /Dry run/);
  assert.throws(() => p.verifyProject({ id: "x", workspace: "wrong", external_source: NAMESPACE }), /identity/);
});
test("only fields changed upstream are candidates for writes", () => {
  assert.deepEqual(
    mergeFields({ name: "a", priority: "low" }, { name: "a", priority: "high" }, { name: "b", priority: "low" }),
    { patch: { name: "b" }, conflicts: [] }
  );
});
test("HTML comparison and Melbourne exclusive cycle dates", () => {
  assert.equal(normalizeHtml("<div><p>&quot;x&quot;&nbsp;</p></div>"), normalizeHtml('<p>"x" </p>'));
  assert.equal(cycleDate("2026-09-03T14:00:00Z", true), "2026-09-03T00:00:00Z");
});
test("private atomic checkpoints and exclusive process lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "mlai-sync-test-"));
  try {
    const store = new Store(directory),
      unlock = store.lock();
    assert.throws(() => store.lock(), { code: "EEXIST" });
    store.save({ version: 1 });
    assert.deepEqual(store.load(), { version: 1 });
    assert.ok(readFileSync(join(directory, "run.lock"), "utf8").includes("pid"));
    unlock();
    const again = store.lock();
    again();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
