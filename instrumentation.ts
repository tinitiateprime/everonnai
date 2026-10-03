export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // Timers require a continuously running Node server. AWS/serverless deployments
  // invoke the authenticated job endpoint from an external scheduler instead.
  const serverless = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY === "true" || process.env.VERCEL;
  const mode = process.env.USAGE_BACKGROUND_MODE || (process.env.NODE_ENV === "development" ? "in-process" : "external");
  if (!serverless && mode === "in-process") (await import("./features/usage/worker")).startUsageWorker();
}
