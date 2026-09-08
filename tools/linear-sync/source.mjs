import { SOURCE_ID } from "./config.mjs";
export const selections = {
  teams: "id name updatedAt archivedAt private",
  users: "id name email active updatedAt",
  externalUsers: "id name updatedAt",
  projects: "id name description createdAt updatedAt archivedAt",
  issues:
    "id identifier title description url createdAt updatedAt archivedAt completedAt priority dueDate estimate labelIds team { id } project { id } state { id } parent { id } cycle { id } assignee { id } creator { id }",
  comments: "id body createdAt updatedAt user { id } externalUser { id } issue { id } project { id }",
  attachments: "id title url createdAt updatedAt issue { id }",
  cycles: "id name number startsAt endsAt createdAt updatedAt archivedAt team { id }",
  workflowStates: "id name color type updatedAt team { id }",
  issueLabels: "id name color description updatedAt team { id }",
  issueRelations: "id type updatedAt issue { id } relatedIssue { id }",
  documents: "id title content url createdAt updatedAt project { id }",
  initiatives: "id name description content createdAt updatedAt",
  projectUpdates: "id body createdAt updatedAt project { id } user { id }",
};
const unfiltered = new Set(["teams", "users", "externalUsers", "workflowStates", "issueLabels", "issueRelations"]);
export class Linear {
  constructor(key, fetcher = fetch) {
    this.key = key;
    this.fetcher = fetcher;
  }
  async query(query, variables = {}) {
    if (!query.startsWith("query Sync") || /\b(mutation|subscription)\b/.test(query))
      throw Error("Linear read-only operation required");
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.fetcher("https://api.linear.app/graphql", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (response.status === 429 || response.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const result = await response.json();
      if (!response.ok || result.errors?.length || !result.data)
        throw Error("Linear query failed (HTTP " + response.status + "); no checkpoint advanced");
      return result.data;
    }
    throw Error("Linear read retry limit");
  }
  async identity() {
    const d = await this.query("query SyncIdentity { organization { id } }");
    if (d.organization.id !== SOURCE_ID) throw Error("Wrong Linear workspace");
  }
  async collection(root, since, full = false) {
    if (!Object.hasOwn(selections, root)) throw Error("Unknown source collection");
    const filtered = !full && !unfiltered.has(root),
      args = ["first: 100", "after: $after", "includeArchived: true"];
    if (root === "users") args.push("includeDisabled: true");
    if (filtered) args.push("filter: { updatedAt: { gte: $since } }");
    const query = `query SyncCollection($after: String${filtered ? ", $since: DateTimeOrDuration" : ""}) { ${root}(${args.join(",")}) { nodes { ${selections[root]} } pageInfo { hasNextPage endCursor } } }`;
    const rows = [],
      seen = new Set();
    let after = null;
    do {
      const page = (await this.query(query, { after, ...(filtered ? { since } : {}) }))[root];
      rows.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
      if (!after || seen.has(after)) throw Error("Invalid source pagination");
      seen.add(after);
    } while (true);
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error("Duplicate source IDs");
    return rows;
  }
}
