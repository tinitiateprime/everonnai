import { servePage } from "@/features/waas/render";
import { errorResponse } from "@/features/waas/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ token: string; path?: string[] }> }) {
  try { const params = await context.params; return await servePage(params.token, params.path || [], true, new URL(request.url).searchParams.get("theme")); }
  catch (error) { return errorResponse(error); }
}
