import { NextResponse } from "next/server";
import { requireProjectManager, requireProjectReader } from "@/features/project-workspace/access";
import { connectRepository, disconnectRepository, listRepositories, readRepositoryCatalog, readRepositoryDocument, readRepositoryImage, syncRepository } from "@/features/project-workspace/repositories";
import { assertSameOrigin, authErrorDetails } from "@/features/auth/session";
import { projectError } from "@/features/project-workspace/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failureResponse(failure: unknown) {
  const details = authErrorDetails(failure, 500);
  return NextResponse.json({ error: [500, 503].includes(details.status) ? "Project repositories are temporarily unavailable. Contact your workspace administrator." : details.message }, { status: details.status, headers });
}
export async function GET(request: Request) {
  try {
    const actor = await requireProjectReader();
    const query = new URL(request.url).searchParams;
    const id = query.get("repositoryId");
    if (!id) return NextResponse.json({ repositories: await listRepositories(actor.workspaceId) }, { headers });
    const name = query.get("path"), asset = query.get("asset");
    if (asset !== null) {
      const image = await readRepositoryImage(actor.workspaceId, id, asset);
      return new NextResponse(new Uint8Array(image.bytes), { headers: { ...headers, "Content-Type": image.contentType, "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    return NextResponse.json(name === null ? await readRepositoryCatalog(actor.workspaceId, id) : await readRepositoryDocument(actor.workspaceId, id, name), { headers });
  } catch (failure) { return failureResponse(failure); }
}
async function input(request: Request) {
  const raw = await request.text();
  if (raw.length > 4000) throw projectError("The repository request is too large.", 413);
  try { const body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); return body; }
  catch { throw projectError("Enter a valid repository request."); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireProjectReader();
    const body = await input(request);
    if (body.action === "sync") return NextResponse.json(await syncRepository(actor.workspaceId, String(body.repositoryId || "")), { headers });
    await requireProjectManager();
    if (body.action !== "connect") throw projectError("Choose a valid repository action.");
    return NextResponse.json(await connectRepository(actor.workspaceId, { url: String(body.url || ""), branch: String(body.branch || ""), folder: String(body.folder || ""), token: String(body.token || "") }), { status: 201, headers });
  } catch (failure) { return failureResponse(failure); }
}
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireProjectManager();
    const body = await input(request);
    await disconnectRepository(actor.workspaceId, String(body.repositoryId || ""), String(body.revision || ""));
    return NextResponse.json({ disconnected: true }, { headers });
  } catch (failure) { return failureResponse(failure); }
}
