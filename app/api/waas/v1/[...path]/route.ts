import { handleApi } from "@/features/waas/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) { return handleApi(request, (await context.params).path); }
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
