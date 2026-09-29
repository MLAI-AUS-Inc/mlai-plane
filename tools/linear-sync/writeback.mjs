import TurndownService from "turndown";
import { ROOT, NAMESPACE } from "./config.mjs";
import { equal, pick } from "./model.mjs";
import { Conflict } from "./engine.mjs";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
const priorityToLinear = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };
const fields = ["name", "description_html", "state", "priority", "target_date", "labels", "assignees"];
const snapshot = (row) => pick(row, fields);
const trimImport = (html) => {
  let body = html ?? "";
  body = body.replace(/^<p>Source: <a [^>]*>[^<]*<\/a><\/p>/, "");
  body = body.replace(/^<p>Original creator: [\s\S]*?<\/p>/, "");
  body = body.replace(/<h3>Original attachment links<\/h3>[\s\S]*$/, "");
  return body;
};
const markdown = (html, imported = false) => turndown.turndown(imported ? trimImport(html) : html ?? "").trim();
const commentMarkdown = (html, imported) => turndown.turndown(imported ? (html ?? "").replace(/^<p>Original author: [\s\S]*?<\/p>/, "") : html ?? "").trim();
const title = (row, source) => row.name?.replace(new RegExp(`^\\[${source.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*`), "").trim();
const sourceFields = (source) => ({
  title: source.title,
  description: source.description ?? "",
  stateId: source.state?.id ?? null,
  priority: source.priority,
  dueDate: source.dueDate ?? null,
  labelIds: [...(source.labelIds ?? [])].sort(),
  assigneeId: source.assignee?.id ?? null,
});
export class Writeback {
  constructor(engine, writer) {
    this.e = engine;
    this.writer = writer;
    this.state = engine.state;
    this.reverse = this.state.reverse ?? { cutover: null, issues: {}, comments: {} };
  }
  conflict(root, id, reason) {
    this.e.report.conflicts.push({ root, id, reason });
  }
  projectKey(projectId) {
    return Object.keys(this.state.projects).find((key) => this.state.projects[key].id === projectId);
  }
  teamFor(projectId, row) {
    const key = this.projectKey(projectId);
    const issues = Object.values(this.e.data.issues).filter((i) => i.project?.id === key);
    let teams = [...new Set(issues.map((i) => i.team?.id).filter(Boolean))];
    if (!teams.length && key?.startsWith("backlog:")) teams = [key.slice(8)];
    if (teams.length > 1 && row.state) {
      const byState = teams.filter((team) => Object.entries(this.state.states).some(([k, v]) =>
        k.startsWith(key + ":") && v === row.state && this.e.data.workflowStates[k.split(":").at(-1)]?.team?.id === team));
      if (byState.length === 1) teams = byState;
    }
    if (teams.length > 1 && teams.includes("def24f5e-2990-4e28-9e06-e89db4a09f9f"))
      return "def24f5e-2990-4e28-9e06-e89db4a09f9f";
    if (teams.length !== 1) throw new Conflict("New Plane issue has ambiguous Linear team");
    return teams[0];
  }
  stateFor(projectId, planeState, teamId) {
    const key = this.projectKey(projectId);
    const ids = Object.entries(this.state.states).filter(([k, v]) => k.startsWith(key + ":") && v === planeState)
      .map(([k]) => k.slice(key.length + 1)).filter((id) => !teamId || this.e.data.workflowStates[id]?.team?.id === teamId);
    if (ids.length !== 1) throw new Conflict("Plane status has no unique Linear state mapping");
    return ids[0];
  }
  labelsFor(projectId, planeLabels, teamId) {
    const key = this.projectKey(projectId);
    return (planeLabels ?? []).map((planeId) => {
      const ids = Object.entries(this.state.labels).filter(([k, v]) => k.startsWith(key + ":") && v === planeId)
        .map(([k]) => k.slice(key.length + 1)).filter((id) => !teamId || this.e.data.issueLabels[id]?.team?.id === teamId);
      if (ids.length !== 1) throw new Conflict("Plane label has no unique Linear mapping");
      return ids[0];
    });
  }
  assigneeFor(row) {
    if (!(row.assignees ?? []).length) return null;
    if (row.assignees.length !== 1) throw new Conflict("Linear supports one assignee; Plane has multiple");
    const member = this.members.find((m) => m.id === row.assignees[0]);
    const users = Object.values(this.e.data.users).filter((u) => u.active && u.email?.toLowerCase() === member?.email?.toLowerCase());
    if (users.length !== 1) throw new Conflict("Plane assignee has no unique Linear user");
    return users[0].id;
  }
  async issue(projectId, row, bootstrapping) {
    if (row.is_draft || row.archived_at || row.external_source && row.external_source !== NAMESPACE) return;
    const mapping = Object.entries(this.state.issues).find(([, m]) => m.id === row.id && m.project === projectId);
    const id = mapping?.[0];
    if (mapping && !this.e.data.issues[id]) return; // Preservation records are not Linear issues.
    const previous = this.reverse.issues[row.id];
    if (bootstrapping) {
      this.reverse.issues[row.id] = { plane: snapshot(row), linear: id ? sourceFields(this.e.data.issues[id]) : null };
      if (id) {
        const map = this.state.issues[id];
        map.sourceTitle ??= this.e.data.issues[id].title;
        map.sourceDescription ??= this.e.data.issues[id].description ?? "";
      }
      return;
    }
    if (!previous && (id || Date.parse(row.created_at) < Date.parse(this.reverse.cutover))) {
      this.reverse.issues[row.id] = { plane: snapshot(row), linear: id ? sourceFields(this.e.data.issues[id]) : null };
      this.e.save();
      return;
    }
    if (!id) {
      if (row.external_source === NAMESPACE) throw new Conflict("Imported Plane issue has no checkpoint mapping");
      return this.createIssue(projectId, row);
    }
    const changed = fields.filter((field) => !equal(field, row[field], previous.plane[field]));
    if (!changed.length) return;
    const cached = this.e.data.issues[id];
    const fresh = await this.e.linear.issue(id);
    if (!fresh) throw new Conflict("Mapped Linear issue disappeared");
    const baseline = previous.linear;
    const patch = {};
    const team = cached.team?.id;
    for (const field of changed) {
      if (field === "name") {
        if (fresh.title !== baseline.title) throw new Conflict("Title changed in both systems");
        patch.title = title(row, fresh);
      } else if (field === "description_html") {
        if ((fresh.description ?? "") !== baseline.description) throw new Conflict("Description changed in both systems");
        patch.description = markdown(row.description_html, true);
      } else if (field === "priority") {
        if (fresh.priority !== baseline.priority) throw new Conflict("Priority changed in both systems");
        if (!(row.priority in priorityToLinear)) throw new Conflict("Unsupported Plane priority");
        patch.priority = priorityToLinear[row.priority];
      } else if (field === "target_date") {
        if ((fresh.dueDate ?? null) !== baseline.dueDate) throw new Conflict("Due date changed in both systems");
        patch.dueDate = row.target_date ?? null;
      } else if (field === "state") {
        if (fresh.state?.id !== baseline.stateId) throw new Conflict("Status changed in both systems");
        patch.stateId = this.stateFor(projectId, row.state, team);
      } else if (field === "labels") {
        if (!equal("labelIds", fresh.labelIds, baseline.labelIds)) throw new Conflict("Labels changed in both systems");
        patch.labelIds = this.labelsFor(projectId, row.labels, team);
      } else if (field === "assignees") {
        if ((fresh.assignee?.id ?? null) !== baseline.assigneeId) throw new Conflict("Assignee changed in both systems");
        patch.assigneeId = this.assigneeFor(row);
      }
    }
    this.e.report.changes.push({ kind: "linear-issue", id, action: "update", fields: Object.keys(patch) });
    this.e.report.updates++;
    if (!this.e.apply) return;
    const path = ROOT + projectId + "/work-items/" + row.id + "/";
    const latest = await this.e.plane.request("GET", path);
    if (!latest || changed.some((field) => !equal(field, latest[field], row[field]))) throw new Conflict("Plane issue changed during writeback");
    const again = await this.e.linear.issue(id);
    if (again.updatedAt !== fresh.updatedAt) throw new Conflict("Linear issue changed during writeback");
    const saved = await this.writer.issueUpdate(id, patch);
    if (saved.id !== id) throw Error("Linear issue update identity mismatch");
    const refreshed = await this.e.linear.issue(id);
    this.e.data.issues[id] = refreshed;
    const map = this.state.issues[id];
    map.last = { ...map.last, ...snapshot(row) };
    map.sourceTitle = refreshed.title;
    map.sourceDescription = refreshed.description ?? "";
    this.reverse.issues[row.id] = { plane: snapshot(row), linear: sourceFields(refreshed) };
    this.e.save();
  }
  async createIssue(projectId, row) {
    const teamId = this.teamFor(projectId, row);
    const projectKey = this.projectKey(projectId);
    const project = this.e.data.projects[projectKey];
    if (!project || projectKey === "archive") throw new Conflict("New Plane issue requires a mapped Linear project");
    const input = {
      id: row.id, teamId, projectId: projectKey, title: row.name?.trim(),
      description: markdown(row.description_html),
      priority: priorityToLinear[row.priority],
      dueDate: row.target_date ?? null,
    };
    if (!input.title || input.priority === undefined) throw new Conflict("New Plane issue has invalid title or priority");
    if (row.state) input.stateId = this.stateFor(projectId, row.state, teamId);
    if (row.labels?.length) input.labelIds = this.labelsFor(projectId, row.labels, teamId);
    if (row.assignees?.length) input.assigneeId = this.assigneeFor(row);
    this.e.report.creates++;
    this.e.report.changes.push({ kind: "linear-issue", id: row.id, action: "create" });
    if (!this.e.apply) return;
    let saved = await this.e.linear.issue(row.id);
    if (!saved) {
      this.state.intents["linear-issue:" + row.id] = { input };
      this.e.save();
      saved = await this.writer.issueCreate(input);
    }
    if (saved.id !== row.id) throw Error("Linear issue create identity mismatch");
    const source = await this.e.linear.issue(row.id);
    if (!source) throw Error("Linear issue create verification failed");
    this.e.data.issues[row.id] = source;
    this.state.issues[row.id] = { id: row.id, project: projectId, origin: "plane", last: { ...snapshot(row), parent: row.parent ?? null, archived_at: row.archived_at ?? null, created_at: row.created_at }, sourceTitle: source.title, sourceDescription: source.description ?? "" };
    this.reverse.issues[row.id] = { plane: snapshot(row), linear: sourceFields(source) };
    delete this.state.intents["linear-issue:" + row.id];
    this.e.save();
  }
  async comments(projectId, row, bootstrapping) {
    const path = ROOT + projectId + "/work-items/" + row.id + "/comments/";
    const linearIssueId = Object.entries(this.state.issues).find(([, m]) => m.id === row.id && m.project === projectId)?.[0];
    if (!linearIssueId || !this.e.data.issues[linearIssueId]) return;
    for (const comment of await this.e.plane.list(path)) {
      const mapping = Object.entries(this.state.comments).find(([, m]) => m.id === comment.id && m.issue === row.id);
      const id = mapping?.[0];
      let previous = this.reverse.comments[comment.id];
      if (bootstrapping || !previous && Date.parse(comment.updated_at ?? comment.created_at) < Date.parse(this.reverse.cutover)) {
        this.reverse.comments[comment.id] = { html: comment.comment_html, body: id ? this.e.data.comments[id]?.body ?? "" : null };
        continue;
      }
      if (!previous && id) previous = { html: this.state.comments[id].last.comment_html, body: this.e.data.comments[id]?.body ?? "" };
      if (previous && equal("comment_html", comment.comment_html, previous.html)) continue;
      if (!id && comment.external_source === NAMESPACE) throw new Conflict("Imported Plane comment has no checkpoint mapping");
      const body = commentMarkdown(comment.comment_html, !!id);
      this.e.report.changes.push({ kind: "linear-comment", id: id ?? comment.id, action: id ? "update" : "create" });
      if (id) this.e.report.updates++;
      else this.e.report.creates++;
      if (!this.e.apply) continue;
      const freshPlane = await this.e.plane.request("GET", path + comment.id + "/");
      if (!freshPlane || !equal("comment_html", freshPlane.comment_html, comment.comment_html)) throw new Conflict("Plane comment changed during writeback");
      if (id) {
        const current = await this.e.linear.comment(id);
        if (!current || current.body !== previous.body) throw new Conflict("Comment changed in both systems");
        await this.writer.commentUpdate(id, { body });
      } else {
        const current = await this.e.linear.comment(comment.id);
        if (!current) {
          this.state.intents["linear-comment:" + comment.id] = { issueId: linearIssueId, body };
          this.e.save();
          await this.writer.commentCreate({ id: comment.id, issueId: linearIssueId, body });
        }
      }
      const source = await this.e.linear.comment(id ?? comment.id);
      if (!source) throw Error("Linear comment verification failed");
      this.e.data.comments[source.id] = source;
      this.state.comments[source.id] = { id: comment.id, issue: row.id, project: projectId, origin: id ? mapping[1].origin : "plane", sourceBody: source.body, last: { comment_html: comment.comment_html, created_at: comment.created_at } };
      this.reverse.comments[comment.id] = { html: comment.comment_html, body: source.body };
      delete this.state.intents["linear-comment:" + comment.id];
      this.e.save();
    }
  }
  async run() {
    if (!this.e.apply && !this.state.reverse) this.e.report.changes.push({ kind: "writeback", action: "bootstrap-baseline" });
    const bootstrap = !this.reverse.cutover;
    if (this.e.apply) {
      this.state.reverse = this.reverse;
      if (bootstrap) this.reverse.cutover = this.e.report.startedAt;
    }
    this.members = this.e.members ?? await this.e.plane.list("/api/v1/workspaces/mlai/members/");
    for (const [key, project] of Object.entries(this.state.projects)) {
      if (key === "archive" || project.archived || !this.e.data.projects[key] && !key.startsWith("backlog:")) continue;
      const path = ROOT + project.id + "/work-items/?per_page=100&order_by=-updated_at";
      let rows;
      try { await this.e.project(key); rows = await this.e.plane.list(path); }
      catch (error) { this.conflict("projects", key, error.message); continue; }
      for (const row of rows) {
        try { await this.issue(project.id, row, bootstrap); }
        catch (error) {
          if (!(error instanceof Conflict)) throw error;
          this.conflict("plane-issues", row.id, error.message);
        }
        if (!bootstrap && Date.parse(row.updated_at) >= Date.parse(this.reverse.cutover)) {
          try { await this.comments(project.id, row, false); }
          catch (error) {
            if (!(error instanceof Conflict)) throw error;
            this.conflict("plane-comments", row.id, error.message);
          }
        }
      }
    }
    this.e.save();
  }
}
