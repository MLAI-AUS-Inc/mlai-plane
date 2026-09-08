import { API_ORIGIN, ROOT, NAMESPACE, TARGET_ID } from "./config.mjs";
export class Plane {
  constructor(config, { apply = false, fetcher = fetch, pace = 1200 } = {}) {
    this.config = config;
    this.apply = apply;
    this.fetcher = fetcher;
    this.pace = pace;
    this.last = 0;
    this.projects = new Set();
  }
  async request(method, path, body) {
    if (!path.startsWith("/api/v1/") || path.includes("..") || path.includes("\\"))
      throw Error("Invalid destination path");
    if (method !== "GET") {
      if (!this.apply) throw Error("Dry run cannot write to Plane");
      if (!["POST", "PATCH"].includes(method) || !path.startsWith(ROOT)) throw Error("Plane operation not allowed");
      if (path !== ROOT) {
        const id = path.slice(ROOT.length).split("/")[0];
        if (!this.projects.has(id)) throw Error("Write outside verified imported projects");
      }
      if (path.includes("/members") || path.includes("/invit")) throw Error("Identity writes prohibited");
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, Math.max(0, this.pace - (Date.now() - this.last))));
      this.last = Date.now();
      let response;
      try {
        response = await this.fetcher(API_ORIGIN + path, {
          method,
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
          headers: {
            "X-API-Key": this.config.planeKey,
            "CF-Access-Client-Id": this.config.cfId,
            "CF-Access-Client-Secret": this.config.cfSecret,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        throw Error(
          method === "GET" ? "Plane read transport failure" : "Ambiguous Plane write; retry through reconciliation"
        );
      }
      if (response.status === 429 || (method === "GET" && response.status >= 500)) {
        await new Promise((r) =>
          setTimeout(r, Math.min(30000, Math.max(2000, Number(response.headers.get("retry-after") ?? 2) * 1000)))
        );
        continue;
      }
      if (response.status === 404 && method === "GET") return null;
      if (!response.ok) throw Error("Plane " + method + " failed (HTTP " + response.status + ")");
      return response.status === 204 ? null : response.json();
    }
    throw Error("Plane retry limit");
  }
  async list(path) {
    const rows = [],
      seen = new Set();
    let cursor = null;
    do {
      const page = await this.request(
        "GET",
        path + (cursor ? (path.includes("?") ? "&" : "?") + "cursor=" + encodeURIComponent(cursor) : "")
      );
      if (Array.isArray(page)) return page;
      if (!Array.isArray(page?.results)) throw Error("Invalid Plane list for " + path.split("?")[0]);
      rows.push(...page.results);
      if (!page.next_page_results) return rows;
      cursor = page.next_cursor;
      if (!cursor || seen.has(cursor)) throw Error("Invalid Plane pagination");
      seen.add(cursor);
    } while (true);
  }
  verifyProject(project) {
    if (project.workspace !== TARGET_ID || project.external_source !== NAMESPACE)
      throw Error("Wrong destination project identity");
    this.projects.add(project.id);
    return project;
  }
}
