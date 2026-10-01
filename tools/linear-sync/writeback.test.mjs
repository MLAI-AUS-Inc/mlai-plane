import test from "node:test";
import assert from "node:assert/strict";
import { Writeback } from "./writeback.mjs";
import { LinearWriter } from "./linear-write.mjs";
import { SOURCE_ID } from "./config.mjs";

const project = "34e2abe0-12b8-4f99-9bd0-43be43ade098";
const sourceProject = "988ce35c-3ce2-4499-920a-68ae00fcfa90";
const team = "def24f5e-2990-4e28-9e06-e89db4a09f9f";
const issueId = "e1c2841c-374e-43d9-8bbc-f9bd9b24a56f";
const source = { id: issueId, identifier: "MLAI-9", title: "Old", description: "Old body", priority: 3,
  dueDate: null, labelIds: [], team: { id: team }, project: { id: sourceProject }, state: { id: "state1" }, assignee: null, updatedAt: "2026-09-29T01:00:00Z" };
const row = { id: issueId, project, name: "[MLAI-9] New", description_html: "<p>Source: <a href='x'>MLAI-9</a></p><p>Original creator: C; original date: today.</p><p>New body</p>", state: "plane-state", priority: "medium", target_date: null, labels: [], assignees: [], created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-29T02:00:00Z" };
function fixture(apply = true) {
  const state = { projects: { [sourceProject]: { id: project } }, issues: { [issueId]: { id: issueId, project, last: { name: "[MLAI-9] Old", description_html: "<p>Old body</p>" } } }, comments: {}, intents: {}, states: { [sourceProject + ":state1"]: "plane-state" }, labels: {}, data: { issues: { [issueId]: structuredClone(source) }, comments: {}, projects: { [sourceProject]: { id: sourceProject } }, users: {}, workflowStates: { state1: { team: { id: team } } } }, reverse: { cutover: "2026-09-29T01:30:00Z", issues: { [issueId]: { plane: { name: "[MLAI-9] Old", description_html: "<p>Old body</p>", state: "plane-state", priority: "medium", target_date: null, labels: [], assignees: [] }, linear: { title: "Old", description: "Old body", stateId: "state1", priority: 3, dueDate: null, labelIds: [], assigneeId: null } } }, comments: {} } };
  const writes = [];
  const liveSource = structuredClone(source);
  const engine = { state, data: state.data, apply, report: { startedAt: "2026-09-29T03:00:00Z", changes: [], creates: 0, updates: 0, conflicts: [] }, save() {}, plane: { async request() { return row; } }, linear: { async issue() { return structuredClone(liveSource); } } };
  const writer = { async issueUpdate(id, input) { writes.push([id, input]); liveSource.title = input.title; liveSource.description = input.description; return { id }; } };
  const wb = new Writeback(engine, writer);
  return { wb, engine, writes };
}
test("Plane edits write title and clean description to Linear once", async () => {
  const { wb, engine, writes } = fixture();
  await wb.issue(project, row, false);
  assert.deepEqual(writes, [[issueId, { title: "New", description: "New body" }]]);
  assert.equal(engine.state.issues[issueId].sourceTitle, "New");
  assert.equal(engine.state.reverse.issues[issueId].plane.name, row.name);
});
test("first reverse baseline never writes existing imported edits", async () => {
  const { wb, writes } = fixture();
  await wb.issue(project, row, true);
  assert.equal(writes.length, 0);
  assert.equal(wb.reverse.issues[issueId].plane.name, row.name);
});
test("dry-run plans edit without writer call or checkpoint mutation", async () => {
  const { wb, writes, engine } = fixture(false);
  const before = structuredClone(engine.state.reverse);
  await wb.issue(project, row, false);
  assert.equal(writes.length, 0);
  assert.deepEqual(engine.state.reverse, before);
});
test("writer refuses mutations in dry-run and rejects unrelated operations", async () => {
  let calls = 0;
  const writer = new LinearWriter("key", { fetcher: () => { calls++; } });
  await assert.rejects(writer.issueCreate({}), /Dry run/);
  writer.apply = true;
  await assert.rejects(writer.request("mutation DeleteAll { issueDelete(id: \"x\") { success } }"), /not allowed/);
  assert.equal(calls, 0);
});
test("new Plane issue uses its UUID for idempotent Linear creation", async () => {
  const { wb, engine } = fixture();
  const newId = "66e9aba5-51b2-4fa5-83c5-423b1223ed85";
  const newRow = { ...row, id: newId, name: "Volunteer task", description_html: "<p>Help with Plane</p>", created_at: "2026-09-29T02:00:00Z" };
  const calls = [];
  wb.writer.issueCreate = async (input) => { calls.push(input); return { id: newId }; };
  engine.linear.issue = async (id) => id === newId && calls.length ? { ...source, id: newId, title: newRow.name, description: "Help with Plane" } : null;
  await wb.issue(project, newRow, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, newId);
  assert.equal(calls[0].teamId, team);
  assert.equal(engine.state.issues[newId].origin, "plane");
  assert.equal(engine.state.intents["linear-issue:" + newId], undefined);
});
test("Linear changes to the same Plane field stop writeback", async () => {
  const { wb, engine, writes } = fixture();
  engine.linear.issue = async () => ({ ...source, title: "Changed in Linear" });
  await assert.rejects(wb.issue(project, row, false), /changed in both systems/);
  assert.equal(writes.length, 0);
});
test("new Plane comment on imported issue targets the Linear issue ID", async () => {
  const { wb, engine } = fixture();
  const linearId = "98764a63-913b-4fef-a596-0c6f86a2cc34";
  engine.state.issues = { [linearId]: { id: issueId, project, last: {} } };
  engine.data.issues[linearId] = { ...source, id: linearId };
  const commentId = "622143e1-d863-4d5a-8907-4040d2a2a8a2";
  const comment = { id: commentId, comment_html: "<p>Hello volunteer</p>", created_at: "2026-09-29T02:00:00Z", updated_at: "2026-09-29T02:00:00Z" };
  engine.plane.list = async () => [comment];
  engine.plane.request = async () => comment;
  const calls = [];
  engine.linear.comment = async () => calls.length ? ({ id: commentId, body: "Hello volunteer", issue: { id: linearId } }) : null;
  wb.writer.commentCreate = async (input) => { calls.push(input); return { id: commentId }; };
  await wb.comments(project, row, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].issueId, linearId);
  assert.equal(engine.state.comments[commentId].issue, issueId);
});
test("newly imported Linear issue receives a reverse baseline without writeback", async () => {
  const { wb, writes } = fixture();
  delete wb.reverse.issues[issueId];
  await wb.issue(project, { ...row, created_at: "2026-09-29T02:00:00Z" }, false);
  assert.equal(writes.length, 0);
  assert.equal(wb.reverse.issues[issueId].linear.title, "Old");
});
test("Plane volunteer assignee maps to a matching Linear member", () => {
  const { wb, engine } = fixture();
  engine.data.users["linear-volunteer"] = { id: "linear-volunteer", email: "volunteer@mlai.au", active: true };
  wb.members = [{ id: "plane-volunteer", email: "volunteer@mlai.au" }];
  assert.equal(wb.assigneeFor({ assignees: ["plane-volunteer"] }), "linear-volunteer");
});
test("Plane issue created during baseline is left for the next writeback run", async () => {
  const { wb, engine } = fixture();
  const newId = "66e9aba5-51b2-4fa5-83c5-423b1223ed85";
  await wb.issue(project, { ...row, id: newId, created_at: "2026-09-29T02:00:00Z" }, true);
  assert.equal(wb.reverse.issues[newId], undefined);
  assert.equal(engine.report.creates, 0);
});

test("write credential identity retries a temporary non-JSON Linear error", async () => {
  let calls = 0;
  const writer = new LinearWriter("key", { apply: true, fetcher: async () => {
    calls++;
    return calls === 1
      ? new Response("upstream connect error", { status: 503 })
      : Response.json({ data: { organization: { id: SOURCE_ID } } });
  } });
  await writer.identity();
  assert.equal(calls, 2);
});
