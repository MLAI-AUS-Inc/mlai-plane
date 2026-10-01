import { ROOT, NAMESPACE, SOURCE_ID, TARGET_ID } from "./config.mjs";
import { selections } from "./source.mjs";
import {
  projectKey,
  projectName,
  stateGroup,
  issueBody,
  commentBody,
  render,
  esc,
  pick,
  ISSUE_FIELDS,
  mergeFields,
  equal,
  cycleDate,
  hash,
} from "./model.mjs";
import { copyFiles } from "./files.mjs";
export class Conflict extends Error {}
export class Engine {
  constructor({ state, store, linear, plane, apply = false, now = () => new Date() }) {
    Object.assign(this, { state, store, linear, plane, apply, now });
    this.data = state.data;
    this.checked = new Map();
    this.report = {
      startedAt: now().toISOString(),
      mode: apply ? "apply" : "dry-run",
      creates: 0,
      updates: 0,
      unchanged: 0,
      files: 0,
      skippedFiles: 0,
      conflicts: [],
      changes: [],
      sourceCounts: {},
    };
  }
  save() {
    if (this.apply) this.store.save(this.state);
  }
  async project(key) {
    if (this.checked.has(key)) return this.checked.get(key);
    let map = this.state.projects[key];
    if (map) {
      const row = await this.plane.request("GET", ROOT + map.id + "/");
      if (!row || row.external_id !== key) throw new Conflict("Imported project missing or changed identity");
      this.plane.verifyProject(row);
      this.checked.set(key, row);
      return row;
    }
    const source =
      this.data.projects[key] ??
      (key.startsWith("backlog:") ? { id: key, name: this.data.teams[key.slice(8)]?.name + " Backlog" } : null);
    if (!source) throw new Conflict("Unknown project dependency");
    const identifier = (
      key.startsWith("backlog:")
        ? "LB" + key.slice(8).replaceAll("-", "").slice(0, 7)
        : "L" + key.replaceAll("-", "").slice(0, 8)
    ).toUpperCase();
    const desired = {
      name: projectName(source.name),
      description: `Original Linear project: ${source.name}\nSource ID: ${key}\n${source.description ?? ""}`,
      identifier,
      external_source: NAMESPACE,
      external_id: key,
      cycle_view: true,
      module_view: true,
      timezone: "Australia/Melbourne",
    };
    const existing = await this.plane.list(ROOT);
    const matches = existing.filter((p) => p.external_source === NAMESPACE && p.external_id === key);
    if (matches.length > 1) throw new Conflict("Duplicate project source IDs");
    let row = matches[0];
    if (row && !this.state.intents["project:" + key]) throw new Conflict("Unowned existing project mapping");
    if (!row) {
      if (existing.some((p) => p.name === desired.name || p.identifier === identifier))
        throw new Conflict("Project name or identifier collision");
      this.report.creates++;
      this.report.changes.push({ kind: "project", id: key, action: "create" });
      if (!this.apply) row = { ...desired, id: "dry:" + key, workspace: TARGET_ID };
      else {
        this.state.intents["project:" + key] = desired;
        this.save();
        row = await this.plane.request("POST", ROOT, desired);
      }
    }
    if (this.apply) this.plane.verifyProject(row);
    map = { id: row.id, last: pick(desired, ["name", "description"]), archived: false };
    this.state.projects[key] = map;
    delete this.state.intents["project:" + key];
    this.save();
    this.checked.set(key, row);
    return row;
  }
  async upsert(kind, id, project, desired, { issueId, sourceId = id } = {}) {
    const maps = kind === "comment" ? this.state.comments : this.state.issues;
    let map = maps[id];
    const base = ROOT + project + "/work-items/";
    const collection = kind === "comment" ? base + issueId + "/comments/" : base;
    const keys = Object.keys(desired),
      intentKey = kind + ":" + id;
    const readById = async (recordId) => {
      const row = await this.plane.request("GET", collection + recordId + "/");
      if (row || kind !== "issue") return row;
      // Plane hides archived work items from the direct detail route but still
      // exposes imported items through their external identity.
      const found = await this.plane.request(
        "GET",
        collection + "?external_id=" + encodeURIComponent(sourceId) + "&external_source=" + NAMESPACE
      );
      return found?.id === recordId ? found : null;
    };
    let current = null;
    if (!project.startsWith("dry:") && !issueId?.startsWith("dry:")) {
      if (map) current = await readById(map.id);
      else if (kind === "comment") {
        const rows = await this.plane.list(collection);
        const matches = rows.filter((c) => c.external_id === sourceId && c.external_source === NAMESPACE);
        if (matches.length > 1) throw new Conflict("Duplicate comments");
        current = matches[0];
      } else
        current = await this.plane.request(
          "GET",
          collection + "?external_id=" + encodeURIComponent(sourceId) + "&external_source=" + NAMESPACE
        );
    }
    if (map && (!current || (!map.origin && (current.external_id !== sourceId || current.external_source !== NAMESPACE))))
      throw new Conflict("Mapped destination was removed or changed identity");
    if (current && !map) {
      if (!this.state.intents[intentKey]) throw new Conflict("Uncheckpointed source ID already exists");
      if (keys.some((k) => !equal(k, current[k], desired[k])))
        throw new Conflict("Uncertain create differs from intended content");
      map = maps[id] = { id: current.id, project, last: desired, ...(kind === "comment" ? { issue: issueId } : {}) };
    }
    if (current) {
      const { patch, conflicts } = mergeFields(map.last, current, desired);
      if (conflicts.length) throw new Conflict("Plane edit conflict: " + conflicts.join(","));
      if (!Object.keys(patch).length) {
        this.report.unchanged++;
        map.last = { ...map.last, ...desired };
        delete this.state.intents[intentKey];
        this.save();
        return map;
      }
      this.report.updates++;
      this.report.changes.push({ kind, id, action: "update", fields: Object.keys(patch) });
      if (this.apply) {
        // Re-read immediately before write. Plane does not expose conditional PATCH.
        const fresh = await readById(current.id);
        if (keys.some((k) => !equal(k, fresh[k], current[k]))) throw new Conflict("Destination changed during sync");
        this.state.intents[intentKey] = { desired, previous: map.last };
        this.save();
        await this.plane.request("PATCH", collection + current.id + "/", patch);
        const saved = await readById(current.id);
        if (Object.keys(patch).some((k) => !equal(k, saved[k], patch[k])))
          throw Error("Plane update verification failed");
      }
      map.last = { ...map.last, ...desired };
      delete this.state.intents[intentKey];
      this.save();
      return map;
    }
    this.report.creates++;
    this.report.changes.push({ kind, id, action: "create" });
    let row = { id: "dry:" + id };
    if (this.apply) {
      this.state.intents[intentKey] = { desired };
      this.save();
      row = await this.plane.request("POST", collection, {
        ...desired,
        external_id: sourceId,
        external_source: NAMESPACE,
      });
      const saved = await readById(row.id);
      if (keys.some((k) => !equal(k, saved[k], desired[k]))) throw Error("Plane create verification failed");
    }
    map = maps[id] = { id: row.id, project, last: desired, ...(kind === "comment" ? { issue: issueId } : {}) };
    delete this.state.intents[intentKey];
    this.save();
    return map;
  }
  async stateFor(issue, project) {
    const key = projectKey(issue) + ":" + issue.state.id;
    if (this.state.states[key]) return this.state.states[key];
    const source = this.data.workflowStates[issue.state.id];
    if (!source || !stateGroup(source.type)) throw new Conflict("Unknown workflow state");
    const rows = project.startsWith("dry:") ? [] : await this.plane.list(ROOT + project + "/states/");
    let row = rows.find((s) => s.name === source.name && s.group === stateGroup(source.type));
    if (!row) {
      this.report.creates++;
      row = this.apply
        ? await this.plane.request("POST", ROOT + project + "/states/", {
            name: source.name,
            group: stateGroup(source.type),
            color: source.color,
          })
        : { id: "dry-state:" + key };
    }
    this.state.states[key] = row.id;
    this.save();
    return row.id;
  }
  async labelsFor(issue, project) {
    const labels = [];
    for (const id of issue.labelIds ?? []) {
      const key = projectKey(issue) + ":" + id;
      if (!this.state.labels[key]) {
        const source = this.data.issueLabels[id];
        if (!source) throw new Conflict("Missing label dependency");
        const rows = project.startsWith("dry:") ? [] : await this.plane.list(ROOT + project + "/labels/");
        let row = rows.find((l) => l.external_source === NAMESPACE && l.external_id === id);
        if (!row) {
          this.report.creates++;
          row = this.apply
            ? await this.plane.request("POST", ROOT + project + "/labels/", {
                name: source.name,
                color: source.color,
                description: source.description ?? "",
                external_id: id,
                external_source: NAMESPACE,
              })
            : { id: "dry-label:" + key };
        }
        this.state.labels[key] = row.id;
        this.save();
      }
      labels.push(this.state.labels[key]);
    }
    return labels;
  }
  async issue(source, visiting = new Set()) {
    if (visiting.has(source.id)) throw new Conflict("Cyclic parent dependency");
    visiting.add(source.id);
    const key = projectKey(source),
      p = await this.project(key),
      mapped = this.state.issues[source.id];
    if (mapped && mapped.project !== p.id)
      throw new Conflict("Cross-project move requires review; no duplicate created");
    if (this.state.projects[key].archived) throw new Conflict("Archived destination project requires review");
    const parent = this.data.issues[source.parent?.id];
    let parentId = null;
    if (source.parent && !parent) throw new Conflict("Missing parent dependency");
    if (parent && projectKey(parent) === key) {
      if (!this.state.issues[parent.id]) await this.issue(parent, visiting);
      parentId = this.state.issues[parent.id].id;
    }
    await copyFiles(
      [
        source.description,
        ...Object.values(this.data.attachments)
          .filter((a) => a.issue?.id === source.id)
          .map((a) => a.url),
      ].join("\n"),
      this
    );
    const assignee = this.data.users[source.assignee?.id];
    const matches = assignee?.active ? this.members.filter((m) => m.email?.toLowerCase() === assignee.email?.toLowerCase()) : [];
    const assigned = matches.length === 1 ? [matches[0].id] : [];
    const desired = {
      name: (mapped?.sourceTitle === source.title ? mapped.last.name : mapped?.origin === "plane" ? source.title : `[${source.identifier}] ${source.title}`).slice(0, 255).trim(),
      description_html: mapped?.sourceDescription === (source.description ?? "") ? mapped.last.description_html : mapped?.origin === "plane" ? render(source.description, this.state.files) : issueBody(source, this.data, this.state),
      state: await this.stateFor(source, p.id),
      parent: parentId,
      priority: { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" }[source.priority],
      target_date: source.dueDate ?? null,
      archived_at: source.archivedAt?.slice(0, 10) ?? null,
      labels: await this.labelsFor(source, p.id),
      assignees: assigned,
      created_at: mapped?.origin === "plane" ? mapped.last.created_at : source.createdAt,
    };
    const before = mapped ? { ...mapped.last } : null;
    const result = await this.upsert("issue", source.id, p.id, desired);
    const reverse = this.state.reverse?.issues?.[result.id];
    if (this.apply && reverse && before) {
      for (const field of Object.keys(reverse.plane))
        if (!equal(field, desired[field], before[field]) && equal(field, reverse.plane[field], before[field]))
          reverse.plane[field] = desired[field];
      reverse.linear = { title: source.title, description: source.description ?? "", stateId: source.state?.id ?? null,
        priority: source.priority, dueDate: source.dueDate ?? null, labelIds: [...(source.labelIds ?? [])].sort(),
        assigneeId: source.assignee?.id ?? null };
      this.save();
    }
    if (this.apply) { result.sourceTitle = source.title; result.sourceDescription = source.description ?? ""; this.save(); }
    await this.cycle(source, p.id, result.id);
    return result;
  }
  async cycle(source, project, issue) {
    const previous = this.state.issueCycles?.[source.id];
    if (previous === source.cycle?.id || (!previous && !source.cycle)) return;
    if (!source.cycle) throw new Conflict("Cycle removal requires review; deletes disabled");
    const cycle = this.data.cycles[source.cycle.id];
    if (!cycle) throw new Conflict("Missing cycle dependency");
    const key = projectKey(source) + ":" + cycle.id;
    let id = this.state.cycles[key];
    const root = ROOT + project + "/cycles/";
    let current = id && !project.startsWith("dry:") ? await this.plane.request("GET", root + id + "/") : null;
    if (!id) {
      const rows = project.startsWith("dry:") ? [] : await this.plane.list(root);
      current = rows.find((c) => c.external_source === NAMESPACE && c.external_id === cycle.id);
      id = current?.id;
    }
    if (current?.end_date && Date.parse(current.end_date) < this.now().getTime())
      throw new Conflict("Completed cycle membership is immutable; review required");
    if (previous && this.apply) {
      const oldId = this.state.cycles[projectKey(source) + ":" + previous];
      if (!oldId) throw new Conflict("Previous cycle mapping missing");
      const oldMembers = await this.plane.list(root + oldId + "/cycle-issues/");
      if (!oldMembers.some((m) => m.issue === issue || m.issue?.id === issue || m.id === issue))
        throw new Conflict("Plane cycle membership changed independently");
    }
    if (!id) {
      this.report.creates++;
      current = this.apply
        ? await this.plane.request("POST", root, {
            name: cycle.name ?? `Cycle ${cycle.number}`,
            description: `Original cycle ${cycle.id}: ${cycle.startsAt} to ${cycle.endsAt}`,
            external_id: cycle.id,
            external_source: NAMESPACE,
          })
        : { id: "dry-cycle:" + key };
      id = current.id;
      this.state.cycles[key] = id;
      this.save();
    }
    this.report.changes.push({ kind: "cycle-membership", id: source.id, action: "update" });
    if (this.apply) {
      const members = await this.plane.list(root + id + "/cycle-issues/");
      if (!members.some((m) => m.issue === issue || m.issue?.id === issue || m.id === issue))
        await this.plane.request("POST", root + id + "/cycle-issues/", { issues: [issue] });
    }
    if (!current?.start_date) {
      this.state.cycleDrafts ??= {};
      this.state.cycleDrafts[key] = { id, project, sourceId: cycle.id, projectKey: projectKey(source) };
    }
    this.state.issueCycles ??= {};
    this.state.issueCycles[source.id] = cycle.id;
    this.save();
  }
  async preservation(root, source) {
    const key =
      root === "documents"
        ? "document:" + source.id
        : root === "initiatives"
          ? "initiative:" + source.id
          : "sync:" + root + ":" + source.id;
    const project = this.state.issues[key]?.project ?? (await this.project("archive")).id;
    // Verify ownership even if this preservation item belongs to an imported project.
    const projectKey = Object.keys(this.state.projects).find((k) => this.state.projects[k].id === project);
    await this.project(projectKey);
    const text = source.content ?? source.body ?? source.description ?? "";
    await copyFiles(text, this);
    const desired = {
      name: ("Linear " + root + ": " + (source.title ?? source.name ?? source.id)).slice(0, 255),
      description_html:
        render(text, this.state.files) +
        "<h3>Original source record</h3><pre>" +
        esc(JSON.stringify(source, null, 2)) +
        "</pre>",
      created_at: source.createdAt ?? this.report.startedAt,
    };
    // Stable creation time on entities without source dates.
    if (this.state.issues[key]) desired.created_at = this.state.issues[key].last.created_at;
    await this.upsert("issue", key, project, desired);
  }
  async finalizeCycles() {
    for (const [key, draft] of Object.entries(this.state.cycleDrafts ?? {})) {
      const members = Object.values(this.data.issues).filter(
        (i) => projectKey(i) === draft.projectKey && i.cycle?.id === draft.sourceId
      );
      if (members.some((i) => this.state.issueCycles[i.id] !== draft.sourceId)) {
        this.report.conflicts.push({
          root: "cycles",
          id: draft.sourceId,
          reason: "Draft cycle waits for all source memberships",
        });
        continue;
      }
      const cycle = this.data.cycles[draft.sourceId];
      if (this.apply) {
        const path = ROOT + draft.project + `/cycles/${draft.id}/`,
          current = await this.plane.request("GET", path);
        const day = (x) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "Australia/Melbourne",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(x));
        const matches =
          current?.start_date &&
          current?.end_date &&
          day(current.start_date) === cycleDate(cycle.startsAt).slice(0, 10) &&
          day(current.end_date) === cycleDate(cycle.endsAt, true).slice(0, 10);
        if (!matches) {
          if (current?.start_date || current?.end_date) {
            this.report.conflicts.push({
              root: "cycles",
              id: draft.sourceId,
              reason: "Plane cycle dates changed independently",
            });
            continue;
          }
          const actual = await this.plane.list(path + "cycle-issues/");
          if (
            members.some((i) => !actual.some((m) => [m.id, m.issue, m.issue?.id].includes(this.state.issues[i.id]?.id)))
          ) {
            this.report.conflicts.push({
              root: "cycles",
              id: draft.sourceId,
              reason: "Cycle membership verification failed",
            });
            continue;
          }
          await this.plane.request("PATCH", path, {
            start_date: cycleDate(cycle.startsAt),
            end_date: cycleDate(cycle.endsAt, true),
          });
        }
      }
      delete this.state.cycleDrafts[key];
      this.save();
    }
  }
  async process(root, source) {
    if (root === "projects") {
      const p = await this.project(source.id),
        map = this.state.projects[source.id],
        desired = {
          name: projectName(source.name),
          description: `Original Linear project: ${source.name}\nSource ID: ${source.id}\n${source.description ?? ""}`,
        };
      if (map.archived !== !!source.archivedAt) throw new Conflict("Project archive change requires review");
      const { patch, conflicts } = mergeFields(map.last, p, desired);
      if (conflicts.length) throw new Conflict("Project edit conflict: " + conflicts.join(","));
      if (Object.keys(patch).length) {
        this.report.updates++;
        this.report.changes.push({ kind: "project", id: source.id, action: "update", fields: Object.keys(patch) });
        if (this.apply) {
          const fresh = await this.plane.request("GET", ROOT + p.id + "/");
          if (Object.keys(patch).some((k) => !equal(k, fresh[k], p[k])))
            throw new Conflict("Project changed during sync");
          await this.plane.request("PATCH", ROOT + p.id + "/", patch);
          const saved = await this.plane.request("GET", ROOT + p.id + "/");
          if (Object.keys(patch).some((k) => !equal(k, saved[k], patch[k]))) throw Error("Project verification failed");
        }
      } else this.report.unchanged++;
      map.last = desired;
      this.save();
      return;
    }
    if (root === "issues") return this.issue(source);
    if (root === "comments" && source.issue) {
      let issue = this.state.issues[source.issue.id];
      if (!issue) {
        const sourceIssue = this.data.issues[source.issue.id];
        if (!sourceIssue) throw new Conflict("Comment issue missing");
        issue = await this.issue(sourceIssue);
      }
      const key = Object.keys(this.state.projects).find((k) => this.state.projects[k].id === issue.project);
      await this.project(key);
      await copyFiles(source.body, this);
      const previous = this.state.comments[source.id] ? { ...this.state.comments[source.id].last } : null;
      const result = await this.upsert(
        "comment",
        source.id,
        issue.project,
        { comment_html: this.state.comments[source.id]?.sourceBody === source.body ? this.state.comments[source.id].last.comment_html : this.state.comments[source.id]?.origin === "plane" ? render(source.body, this.state.files) : commentBody(source, this.data, this.state), created_at: source.createdAt },
        { issueId: issue.id }
      );
      const reverse = this.state.reverse?.comments?.[result.id];
      if (this.apply && reverse && previous && !equal("comment_html", result.last.comment_html, previous.comment_html) &&
          equal("comment_html", reverse.html, previous.comment_html)) {
        reverse.html = result.last.comment_html; reverse.body = source.body; this.save();
      }
      if (this.apply) { result.sourceBody = source.body; this.save(); }
      return result;
    }
    if (root === "attachments") return; // Its parent issue is queued while collecting deltas.
    if (["teams", "users", "externalUsers"].includes(root)) return;
    if (["workflowStates", "issueLabels"].includes(root))
      throw new Conflict("Shared state/label metadata changed; review mapping before updating");
    if (root === "issueRelations") {
      if (this.state.relations[source.id]) return;
      const a = this.state.issues[source.issue?.id],
        b = this.state.issues[source.relatedIssue?.id];
      if (!a || !b) throw new Conflict("Relationship dependency missing");
      await this.project(Object.keys(this.state.projects).find((k) => this.state.projects[k].id === a.project));
      const type = { related: "relates_to", blocks: "blocking", duplicate: "duplicate" }[source.type];
      if (!type) throw new Conflict("Unsupported relation type");
      this.report.changes.push({ kind: "relation", id: source.id, action: "create" });
      if (this.apply)
        await this.plane.request("POST", ROOT + a.project + `/work-items/${a.id}/relations/`, {
          relation_type: type,
          issues: [b.id],
        });
      this.state.relations[source.id] = true;
      this.save();
      return;
    }
    // Unsupported mutable records are preserved, not silently ignored or forced
    // through completed-cycle restrictions. Native immutable changes need review.
    if (root === "cycles") {
      const mapped = Object.keys(this.state.cycles).filter((k) => k.endsWith(":" + source.id));
      if (mapped.some((k) => !this.state.cycleDrafts?.[k]))
        throw new Conflict("Existing cycle metadata changed; review required");
      if (mapped.length) return; // New drafts already contain this source metadata.
    }
    return this.preservation(root, source);
  }
  async run({ reconcile = false } = {}) {
    if (
      this.state.version !== 1 ||
      this.state.sourceId !== SOURCE_ID ||
      this.state.targetId !== TARGET_ID ||
      this.state.namespace !== NAMESPACE
    )
      throw Error("Wrong checkpoint identity");
    await this.linear.identity();
    this.me = await this.plane.request("GET", "/api/v1/users/me/");
    if (!this.me?.id || !this.me.email) throw Error("Plane authentication failed");
    this.members = await this.plane.list("/api/v1/workspaces/mlai/members/");
    await this.project("archive");
    const since = new Date(Date.parse(this.state.watermark) - 5 * 60 * 1000).toISOString();
    const daily =
      reconcile ||
      !this.state.lastReconcile ||
      Date.parse(this.report.startedAt) - Date.parse(this.state.lastReconcile) > 86400000;
    const deltas = {};
    for (const root of Object.keys(selections)) {
      deltas[root] = await this.linear.collection(root, since, daily);
      this.report.sourceCounts[root] = deltas[root].length;
    }
    if (deltas.teams.some((t) => t.private)) throw Error("Private source team requires explicit visibility mapping");
    for (const [root, rows] of Object.entries(deltas)) {
      if (daily) {
        const ids = new Set(rows.map((r) => r.id));
        for (const id of Object.keys(this.data[root]))
          if (!ids.has(id))
            this.report.conflicts.push({
              root,
              id,
              reason: "Source missing or no longer visible; destination retained",
            });
      }
      for (const source of rows) {
        const previous = this.data[root][source.id];
        if (!previous || previous.updatedAt !== source.updatedAt) {
          const relevant = {
            cycles: ["name", "number", "startsAt", "endsAt", "archivedAt"],
            users: ["name", "email", "active"],
            workflowStates: ["name", "color", "type"],
            issueLabels: ["name", "color", "description"],
          }[root];
          this.data[root][source.id] = source;
          if (!previous || !relevant || relevant.some((k) => !equal(k, previous[k], source[k])))
            this.state.pending[root][source.id] = true;
        }
      }
    }
    for (const id of Object.keys(this.state.pending.attachments)) {
      const i = this.data.attachments[id].issue?.id;
      if (i && this.data.issues[i]) this.state.pending.issues[i] = true;
    }
    for (const id of Object.keys(this.state.pending.users))
      for (const i of Object.values(this.data.issues))
        if (i.assignee?.id === id || i.creator?.id === id) this.state.pending.issues[i.id] = true;
    this.save();
    for (const root of [
      "teams",
      "users",
      "externalUsers",
      "projects",
      "workflowStates",
      "issueLabels",
      "issues",
      "comments",
      "attachments",
      "cycles",
      "issueRelations",
      "documents",
      "initiatives",
      "projectUpdates",
    ]) {
      for (const id of Object.keys(this.state.pending[root])) {
        try {
          await this.process(root, this.data[root][id]);
          delete this.state.pending[root][id];
          this.save();
        } catch (error) {
          if (!(error instanceof Conflict)) throw error;
          this.report.conflicts.push({ root, id, reason: error.message });
        }
      }
    }
    await this.finalizeCycles();
    // Pending conflicts persist independently of the watermark and are retried.
    this.state.watermark = this.report.startedAt;
    if (daily) this.state.lastReconcile = this.report.startedAt;
    this.state.lastRun = { at: this.report.startedAt, conflicts: this.report.conflicts.length };
    this.save();
    this.report.finishedAt = this.now().toISOString();
    this.report.pending = Object.values(this.state.pending).reduce((n, p) => n + Object.keys(p).length, 0);
    return this.report;
  }
}
