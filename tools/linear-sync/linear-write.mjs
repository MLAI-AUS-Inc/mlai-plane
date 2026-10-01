import { Linear } from "./source.mjs";

const endpoint = "https://api.linear.app/graphql";
export class LinearWriter {
  constructor(key, { apply = false, fetcher = fetch } = {}) {
    this.key = key;
    this.apply = apply;
    this.fetcher = fetcher;
  }
  async identity() {
    if (!this.key) throw Error("LINEAR_WRITE_API_KEY is required for writeback");
    // Reuse the read client's retry and workspace guard. A transient 5xx from
    // Linear can have a plain-text body, so parsing it as JSON would fail here.
    await new Linear(this.key, this.fetcher).identity();
  }
  async request(query, variables = {}) {
    if (!this.apply) throw Error("Dry run cannot write to Linear");
    if (!this.key) throw Error("LINEAR_WRITE_API_KEY is required for writeback");
    if (!/^mutation Sync(IssueCreate|IssueUpdate|CommentCreate|CommentUpdate)\b/.test(query))
      throw Error("Linear mutation not allowed");
    let response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw Error("Ambiguous Linear write; retry through reconciliation");
    }
    const result = await response.json();
    if (!response.ok || result.errors?.length || !result.data)
      throw Error("Linear mutation failed (HTTP " + response.status + "); checkpoint retained");
    const payload = Object.values(result.data)[0];
    if (!payload?.success || !payload?.issue && !payload?.comment)
      throw Error("Linear mutation was not confirmed");
    return payload.issue ?? payload.comment;
  }
  async issueCreate(input) {
    return this.request("mutation SyncIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title description updatedAt } } }", { input });
  }
  async issueUpdate(id, input) {
    return this.request("mutation SyncIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title description updatedAt } } }", { id, input });
  }
  async commentCreate(input) {
    return this.request("mutation SyncCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body updatedAt } } }", { input });
  }
  async commentUpdate(id, input) {
    return this.request("mutation SyncCommentUpdate($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { id body updatedAt } } }", { id, input });
  }
}
