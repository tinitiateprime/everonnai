import { servePage } from "@/features/waas/render";
import { errorResponse } from "@/features/waas/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ slug: string; path?: string[] }> }) {
  try { const params = await context.params; return await servePage(params.slug, params.path || [], false); }
  catch (error) { return errorResponse(error); }
}
