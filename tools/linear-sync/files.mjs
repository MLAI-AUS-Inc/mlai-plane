import { API_ORIGIN, ROOT, NAMESPACE } from "./config.mjs";
import { hash } from "./model.mjs";
import { createHash } from "node:crypto";
const MAX = 5242880;
export async function copyFiles(text, engine) {
  const urls = [...new Set(String(text ?? "").match(/https:\/\/uploads\.linear\.app\/[^\s<>"')\]]+/g) ?? [])];
  for (const url of urls) {
    if (engine.state.files[url] || engine.state.skippedFiles?.[url]) continue;
    const response = await fetch(url, {
      headers: { Authorization: engine.plane.config.linearKey },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error("Linear asset read failed");
    const type = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
    if (type.startsWith("video/") || Number(response.headers.get("content-length")) > MAX) {
      await response.body?.cancel();
      engine.state.skippedFiles ??= {};
      engine.state.skippedFiles[url] = "video-or-oversize";
      engine.report.skippedFiles++;
      engine.save();
      continue;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX) throw Error("Asset exceeds limit without trusted content length");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    engine.report.files++;
    if (!engine.apply) {
      engine.state.files[url] = { url: "/api/assets/planned/" + hash(url) };
      continue;
    }
    const project = await engine.project("archive"),
      issue = engine.state.issues["archive:index"];
    if (!issue) throw Error("Missing source archive");
    const path = ROOT + project.id + `/work-items/${issue.id}/attachments/`,
      external = hash(url);
    engine.state.tickets ??= {};
    let ticket = engine.state.tickets[external];
    if (!ticket) {
      const existing = await engine.plane.list(path);
      const match = existing.find((a) => a.external_id === external && a.external_source === NAMESPACE);
      if (match) throw Error("Uncheckpointed existing asset requires verification");
      ticket = await engine.plane.request("POST", path, {
        name: "linear-sync-" + external.slice(0, 16),
        type,
        size,
        external_source: NAMESPACE,
        external_id: external,
      });
      engine.state.tickets[external] = ticket;
      engine.save();
    }
    const c = engine.plane.config,
      headers = { "CF-Access-Client-Id": c.cfId, "CF-Access-Client-Secret": c.cfSecret };
    // The presigned form only goes to the fixed private Plane storage route.
    const target = new URL(ticket.upload_data.url);
    if (
      !["plane.mlai.au", "plane-origin-staging.mlai.au", "plane-staging.mlai.au"].includes(target.hostname) ||
      target.pathname !== "/uploads"
    )
      throw Error("Unexpected asset upload target");
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.upload_data.fields)) form.append(key, value);
    form.append("file", new Blob([bytes], { type }), ticket.upload_data.fields.key);
    const uploaded = await fetch(API_ORIGIN + "/uploads", {
      method: "POST",
      headers,
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!uploaded.ok) throw Error("Plane storage upload failed");
    await engine.plane.request("PATCH", path + ticket.asset_id + "/", {});
    // Signed downloads need a redirect, unlike JSON API requests; pace this read too.
    await new Promise((r) => setTimeout(r, 1200));
    const signed = await fetch(API_ORIGIN + path + ticket.asset_id + "/", {
      headers: { ...headers, "X-API-Key": c.planeKey },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (signed.status !== 302) throw Error("Asset download authorization failed");
    const location = new URL(signed.headers.get("location"));
    if (
      !["plane.mlai.au", "plane-origin-staging.mlai.au", "plane-staging.mlai.au"].includes(location.hostname) ||
      !location.pathname.startsWith("/uploads/")
    )
      throw Error("Unexpected asset download target");
    const verify = await fetch(API_ORIGIN + location.pathname + location.search, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!verify.ok) throw Error("Asset verification download failed");
    const digest = (b) => createHash("sha256").update(b).digest("hex");
    if (digest(Buffer.from(await verify.arrayBuffer())) !== digest(bytes))
      throw Error("Copied asset checksum mismatch");
    engine.state.files[url] = { id: ticket.asset_id, url: ticket.asset_url, sha256: digest(bytes), size };
    delete engine.state.tickets[external];
    engine.save();
  }
}
