import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import { decodeHTML } from "entities";
import { PUBLIC_URL } from "./config.mjs";
export const esc = (x) =>
  String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const normalizeHtml = (x) =>
  decodeHTML(
    (x ?? "")
      .replace(/^<div>/, "")
      .replace(/<\/div>$/, "")
      .replace(/ rel="noopener noreferrer"/g, "")
  )
    .replace(/\s+(?=<)/g, "")
    .trim();
export const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export const projectKey = (i) => i.project?.id ?? "backlog:" + i.team.id;
export const projectName = (x) =>
  x
    .replace(/[&+,:;$^}{*=?@#|'<>.()%!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
export const stateGroup = (x) =>
  ({
    triage: "backlog",
    backlog: "backlog",
    unstarted: "unstarted",
    started: "started",
    completed: "completed",
    canceled: "cancelled",
    duplicate: "cancelled",
  })[x];
export function normalized(key, value) {
  if (key.endsWith("_html")) return normalizeHtml(value);
  if (key === "name") return value?.trim();
  if (key === "created_at") return value ? new Date(value).toISOString() : null;
  if (Array.isArray(value)) return [...value].sort();
  return value ?? null;
}
export const equal = (key, a, b) => JSON.stringify(normalized(key, a)) === JSON.stringify(normalized(key, b));
export function mergeFields(previous, current, desired) {
  const patch = {},
    conflicts = [];
  for (const [key, value] of Object.entries(desired)) {
    if (previous && equal(key, value, previous[key])) continue;
    if (equal(key, current[key], value)) continue;
    if (!previous || !equal(key, current[key], previous[key])) conflicts.push(key);
    else if (!equal(key, value, previous[key])) patch[key] = value;
    // Plane-only edits on a field unchanged in Linear are preserved.
  }
  return { patch, conflicts };
}
const md = new MarkdownIt({ html: false, linkify: true });
md.renderer.rules.image = (tokens, index, options, env) => {
  const t = tokens[index],
    url = t.attrGet("src"),
    asset = env.assets[url];
  return asset
    ? `<img src="${esc(asset.url)}" alt="${esc(t.content)}">`
    : `<a href="${esc(url)}">${esc(t.content || "Original image")}</a>`;
};
export const render = (text, assets = {}) => md.render(text ?? "", { assets });
export function issueBody(i, data, state) {
  const user = (id) => data.users[id]?.name ?? id ?? "Unassigned";
  const parent = data.issues[i.parent?.id],
    mapped = state.issues[i.parent?.id];
  const cross = parent && projectKey(parent) !== projectKey(i);
  const parentLink = cross
    ? mapped
      ? `${PUBLIC_URL}/mlai/projects/${mapped.project}/issues/${mapped.id}`
      : parent.url
    : null;
  const links = Object.values(data.attachments).filter((a) => a.issue?.id === i.id);
  return (
    `<p>Source: <a href="${esc(i.url)}">${esc(i.identifier)}</a></p>` +
    `<p>Original creator: ${esc(user(i.creator?.id))}; assignee: ${esc(user(i.assignee?.id))}. Original created: ${esc(i.createdAt)}; updated: ${esc(i.updatedAt)}; completed: ${esc(i.completedAt ?? "not completed")}; archived: ${esc(i.archivedAt ?? "not archived")}; estimate: ${esc(i.estimate ?? "none")}.</p>` +
    (parentLink ? `<p>Original cross-project parent: <a href="${esc(parentLink)}">Parent work item</a></p>` : "") +
    render(i.description, state.files) +
    (links.length
      ? "<h3>Original attachment links</h3><ul>" +
        links
          .map((a) => `<li><a href="${esc(state.files[a.url]?.url ?? a.url)}">${esc(a.title || a.url)}</a></li>`)
          .join("") +
        "</ul>"
      : "")
  );
}
export function commentBody(c, data, state) {
  const id = c.user?.id ?? c.externalUser?.id;
  const name = data.users[id]?.name ?? data.externalUsers[id]?.name ?? id ?? "Unknown";
  return `<p>Original author: ${esc(name)}; original date: ${esc(c.createdAt)}.</p>` + render(c.body, state.files);
}
export const ISSUE_FIELDS = [
  "name",
  "description_html",
  "state",
  "parent",
  "priority",
  "target_date",
  "archived_at",
  "labels",
  "assignees",
  "created_at",
];
export const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
export function cycleDate(timestamp, end = false) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.parse(timestamp) - (end ? 1 : 0)));
  return day + "T00:00:00Z";
}
