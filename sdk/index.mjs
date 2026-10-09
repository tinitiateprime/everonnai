export class WaasError extends Error {
  constructor(message, status = 0) { super(message); this.name = "WaasError"; this.status = status; }
}
export function createWaasClient({ baseUrl, apiKey, fetch: fetchImpl = globalThis.fetch }) {
  if (typeof window !== "undefined") throw new Error("Use the WAAS SDK on your server; keep the API key out of browser code.");
  const base = new URL(baseUrl);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("baseUrl must be the service origin, such as https://studio.example.com.");
  if (!apiKey || apiKey.length < 32) throw new Error("A WAAS API key of at least 32 characters is required.");
  const sitePath = id => "sites/" + encodeURIComponent(id);
  async function request(path, method = "GET", body, signal) {
    const response = await fetchImpl(new URL("/api/waas/v1/" + path, base), {
      method, headers: { Authorization: "Bearer " + apiKey, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
    });
    let data;
    try { data = await response.json(); } catch { throw new WaasError("Empty or incomplete service response. Check the saved build before retrying.", response.status); }
    if (!response.ok) throw new WaasError(data.error || "WAAS request failed.", response.status);
    return data;
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  const client = {
    listSites: async () => (await request("sites")).sites,
    createSite: input => request("sites", "POST", input),
    getSite: id => request(sitePath(id)),
    updateSite: (id, input) => request(sitePath(id), "PATCH", input),
    buildStatus: (id, jobId, signal) => request(sitePath(id) + "/build" + (jobId ? "?jobId=" + encodeURIComponent(jobId) : ""), "GET", undefined, signal),
    buildStep: (id, input, signal) => request(sitePath(id) + "/build", "POST", input, signal),
    publish: (id, input) => request(sitePath(id) + "/publish", "POST", input),
    rollback: (id, input) => request(sitePath(id) + "/rollback", "POST", input),
    exportSite: id => request(sitePath(id) + "/export"),
    usage: async id => (await request(sitePath(id) + "/usage")).events,
    async generate(id, { resume = false, signal, onProgress } = {}) {
      let result;
      if (resume) {
        result = await client.buildStatus(id, undefined, signal);
        if (result.job?.status === "failed") result = await client.buildStep(id, { operation: "resume", jobId: result.job.id }, signal);
      } else {
        try { result = await client.buildStep(id, { operation: "start" }, signal); }
        catch (error) {
          signal?.throwIfAborted();
          if (error instanceof WaasError && [400,401,403,409,503].includes(error.status)) throw error;
          result = await client.buildStatus(id, undefined, signal);
          if (!result.job) throw error;
        }
      }
      let failures = 0;
      for (let step = 0; step < 1500; step++) {
        signal?.throwIfAborted();
        if (result.project) return result;
        const job = result.job;
        if (!job) throw new WaasError("No saved build exists. Start a build first.");
        onProgress?.(job);
        if (job.status === "failed") throw new WaasError(job.error || "Website generation failed; resume the saved build after checking the error.");
        if (job.status !== "running") throw new WaasError("The completed draft changed. Fetch the latest website.");
        await wait(Math.max(100, Math.min(job.retryAfterMs || 100, 60_000)), signal);
        try { result = await client.buildStep(id, { operation: "advance", jobId: job.id }, signal); failures = 0; }
        catch (error) {
          signal?.throwIfAborted();
          if (error instanceof WaasError && [400,401,403,409,503].includes(error.status)) throw error;
          if (++failures > 3) throw new WaasError("Connection interrupted. Call generate(id, { resume: true }) to retain completed steps.");
          await wait(1000, signal);
          result = await client.buildStatus(id, job.id, signal);
        }
      }
      throw new WaasError("Build paused after the step limit. Resume the saved build.");
    },
    url: path => new URL(path, base).toString(),
  };
  return client;
}
