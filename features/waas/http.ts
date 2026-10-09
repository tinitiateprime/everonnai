import { authorize } from "./auth";
import { bad } from "./input";
import { createSite, listSites, readSite, siteSummary, updateSite, buildSite, buildStatus, publishSite, rollbackSite, siteUsage } from "./service";
import { exportSite } from "./render";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers }); }
export function errorResponse(error: unknown) {
  const status = Number((error as { status?: number })?.status) || 500;
  let message = status >= 500 ? "The service could not complete this request. Check server configuration and storage, then retry." : error instanceof Error ? error.message : "Request failed.";
  for (const key of ["WAAS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "PEXELS_API_KEY", "DATABASE_URL"]) {
    const secret = process.env[key]; if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return json({ error: message }, status >= 400 && status <= 599 ? status : 500);
}
export async function body(request: Request) {
  if (Number(request.headers.get("content-length")) > 100_000) bad("Request body too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > 100_000) { await reader.cancel(); bad("Request body too large.", 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { const raw = Buffer.concat(chunks).toString("utf8"); return raw ? JSON.parse(raw) : {}; }
  catch { bad("Send valid JSON."); }
}
export async function handleApi(request: Request, path: string[]) {
  try {
    authorize(request);
    const method = request.method;
    if (path[0] !== "sites") bad("API route not found.", 404);
    if (path.length === 1) {
      if (method === "GET") return json({ sites: await listSites() });
      if (method === "POST") return json(await createSite(await body(request)), 201);
    }
    const id = path[1];
    if (id && path.length === 2) {
      if (method === "GET") return json(siteSummary(await readSite(id)));
      if (method === "PATCH") return json(await updateSite(id, await body(request)));
    }
    if (id && path.length === 3) {
      if (path[2] === "build" && method === "GET") return json(await buildStatus(id, new URL(request.url).searchParams.get("jobId") || undefined));
      if (path[2] === "build" && method === "POST") { const result = await buildSite(id, await body(request)); return json(result, result.job?.status === "running" ? 202 : 200); }
      if (path[2] === "publish" && method === "POST") return json(await publishSite(id, await body(request)));
      if (path[2] === "rollback" && method === "POST") return json(await rollbackSite(id, await body(request)));
      if (path[2] === "export" && method === "GET") return json(exportSite(await readSite(id)));
      if (path[2] === "usage" && method === "GET") return json({ events: await siteUsage(id) });
    }
    bad("API route or method not supported.", 404);
  } catch (error) { return errorResponse(error); }
}
