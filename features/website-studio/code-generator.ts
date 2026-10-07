import "server-only";
import type { BusinessProfile, WebsiteCode, WebsiteCodeConcept, WebsiteSpec } from "@/features/everonn/types";
import type { ScopedMemory, WebsiteConcept } from "@/features/agent-runtime/types";
import type { UsageContext } from "@/features/usage/types";
import type { WebsiteGenerationProgress } from "./progress";
import { meteredGeminiRequest } from "@/features/usage/gemini";
import { getGeminiWebsiteCodeTimeout, getGeminiWebsiteConfig } from "@/lib/provider-config";
import { buildWebsitePrompt } from "./prompt";
import { normalizeWebsiteCodeBatch, normalizeWebsiteCodeConcept, normalizeWebsiteDesignSystem, websiteAssets, websitePaths } from "./code-validation";
import { resolvedWebsitePreferences } from "@/features/agent-runtime/memory";
import { runWebsiteQa, WEBSITE_CONCEPTS } from "./generator";

const string = { type: "STRING" };
const PAGE_BATCH_SIZE = 3;
const responseSchema = (paths: string[], initial: boolean, designOnly = false) => ({
  type: "OBJECT", required: designOnly ? ["name", "rationale", "css"] : initial ? ["name", "rationale", "css", "pages"] : ["pages"],
  propertyOrdering: designOnly ? ["name", "rationale", "css"] : initial ? ["name", "rationale", "css", "pages"] : ["pages"],
  properties: {
    ...(initial ? { name: string, rationale: string, css: string } : {}),
    ...(!designOnly ? { pages: { type: "ARRAY", minItems: String(paths.length), maxItems: String(paths.length), items: { type: "OBJECT", required: ["path", "title", "description", "html"], propertyOrdering: ["path", "title", "description", "html"], properties: { path: { ...string, enum: paths }, title: string, description: string, html: string } } } } : {}),
  },
});
export type WebsiteCodeAttempt = { modelIndex: number; validationAttempt: number; previous?: unknown; correction?: string };
type Options = { memory?: ScopedMemory[]; usage?: UsageContext; config?: ReturnType<typeof getGeminiWebsiteConfig>; fetchImpl?: typeof fetch; model?: string; onProgress?: (progress: WebsiteGenerationProgress) => void; signal?: AbortSignal; timeoutMs?: number; attempt?: WebsiteCodeAttempt; singleRequest?: boolean; designOnly?: boolean };
export type WebsiteCodeDesign = { code: WebsiteCodeConcept; model: string };
type Design = WebsiteCodeDesign;

export class WebsiteCodeRetry extends Error {
  constructor(message: string, readonly attempt: WebsiteCodeAttempt) { super(message); this.name = "WebsiteCodeRetry"; }
}

export function generateWebsiteCodeStep(concept: WebsiteConcept, paths: string[], spec: WebsiteSpec, profile: BusinessProfile, options: Options, design?: Design) {
  return generateBatch(concept, paths, spec, profile, { ...options, singleRequest: true }, design);
}

export function generateWebsiteDesignStep(concept: WebsiteConcept, spec: WebsiteSpec, profile: BusinessProfile, options: Options) {
  return generateBatch(concept, [], spec, profile, { ...options, singleRequest: true, designOnly: true });
}

function timeout(error: unknown) {
  return ["TimeoutError", "AbortError"].includes((error as { name?: string })?.name || "");
}

async function generateBatch(concept: WebsiteConcept, paths: string[], spec: WebsiteSpec, profile: BusinessProfile, options: Options, design?: Design): Promise<Design> {
  options.signal?.throwIfAborted();
  const config = options.config || getGeminiWebsiteConfig();
  const prompt = buildWebsitePrompt(profile, options.memory);
  const preferences = resolvedWebsitePreferences(options.memory, profile.workspaceId);
  const models = [...new Set([design?.model || options.model || config.models[0], ...config.models])].filter(Boolean).slice(0, 3);
  const initial = !design;
  let context = `${prompt.context}\n\nWEBSITE_CODE_TASK\nCreate the ${concept} design direction. This is a comparison label, not a predefined layout. Invent a business-specific composition.\nAPPROVED_CONTENT_AND_BRAND:\n${JSON.stringify({ ...spec, code: undefined })}\nREQUIRED_ROUTES (navigation manifest, not this response's page list):\n${JSON.stringify(websitePaths(spec))}\nREQUESTED_PAGE_BATCH (return ONLY these pages):\n${JSON.stringify(paths)}\nAPPROVED_ASSETS:\n${JSON.stringify(websiteAssets(spec))}\n${initial
    ? "Create the complete original reusable CSS design system and the HOME page only. The CSS must also cover service indexes, detail pages, about and contact sections that will follow in separate requests. Invent a coherent visual language and reusable classes for this actual business."
    : `Continue this approved design. Return ONLY pages, without css/name/rationale. Reuse the supplied CSS and classes; never replace the design system.\nDESIGN_NAME: ${design.code.name}\nDESIGN_RATIONALE: ${design.code.rationale}\nEXISTING_CSS:\n${design.code.css}\nAPPROVED_HOME_PAGE (navigation and visual reference):\n${design.code.pages[0]?.html || "No homepage exists yet. Create it now using the approved stylesheet and classes."}`}\nReturn semantic HTML fragments for the requested pages. Use .site as the outer wrapper. Use var(--brand-primary) and var(--brand-accent) in the stylesheet. Images use supplied asset keys, truthful alt text and attribution; never fabricate URLs. Navigation always links exactly to /, /services, /about, /contact. The Services index links to every active service. Use EXACT root-relative routes, never .html or index.html links. CTAs use action:booking, action:chat or action:voice. Each page has one main, one H1, full native navigation and a working CTA; the Contact page includes the real tel/mailto links. Honour hidden homepage sections and the owner's priority service. Tag optional homepage sections with data-section="benefits|about|process|gallery|faq". No scripts, inline styles, forms, inputs, SVG, external fonts, CSS URLs, nesting, imports or dependencies. Use native details/summary for menus and FAQs. Provide responsive CSS, readable contrast, visible focus and reduced-motion styling. Keep CSS around 4000-6500 characters, home HTML around 4000-5500, and each other page around 2200-3500 characters with useful approved content. Return only response-schema JSON for this requested batch; other routes are built separately.`;
  if (options.designOnly) {
    context = context.replace("WEBSITE_CODE_TASK", "WEBSITE_DESIGN_TASK")
      .replace("and the HOME page only", "only, without HTML or pages")
      + "\nThis unit returns ONLY name, rationale and css. Describe your original visual language and reusable classes in the rationale. HTML and every page, including Home, are generated in later requests with this stylesheet. Keep the CSS concise and complete. Do not include pages or page HTML in this response.";
  }
  let correction = options.attempt?.correction || "";
  let previous: unknown = options.attempt?.previous;
  let modelIndex = options.attempt?.modelIndex || 0;
  const timeoutMs = Math.min(options.timeoutMs || getGeminiWebsiteCodeTimeout(), getGeminiWebsiteCodeTimeout());
  for (let validationAttempt = options.attempt?.validationAttempt || 0; validationAttempt < 2; validationAttempt++) {
    const contents = [{ role: "user", parts: [{ text: context }] }];
    if (validationAttempt && previous) {
      contents.push({ role: "model", parts: [{ text: JSON.stringify(previous) }] });
      contents.push({ role: "user", parts: [{ text: `Repair this requested page batch and return its complete JSON. Validator feedback: ${correction}` }] });
    }
    let payload: unknown;
    for (;;) {
      const model = models[modelIndex];
      try {
        options.signal?.throwIfAborted();
        const result = await meteredGeminiRequest(model, config.apiKey, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: prompt.systemInstruction }] }, contents, generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema(paths, initial, options.designOnly), temperature: .7, maxOutputTokens: 16384 } }),
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]), cache: "no-store",
        }, { fetchImpl: options.fetchImpl || fetch, usage: options.usage });
        if (!result.response.ok) {
          const status = result.response.status;
          throw Object.assign(new Error(`Gemini website code request returned HTTP ${status}.`), { retryable: [408, 429, 404].includes(status) || status >= 500 });
        }
        payload = result.payload;
        break;
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        const networkFailure = error instanceof TypeError && /fetch failed|failed to fetch|network/i.test(error.message);
        const canRetry = timeout(error) || (error as { retryable?: boolean })?.retryable || networkFailure;
        if (!canRetry || modelIndex >= models.length - 1) {
          const reason = timeout(error) ? `The AI response exceeded ${timeoutMs / 1000} seconds.` : error instanceof Error ? error.message : "The provider could not be reached.";
          throw new Error(`Website generation stopped while building ${concept}: ${paths.join(", ")}. ${reason}`);
        }
        modelIndex++;
        if (options.singleRequest) throw new WebsiteCodeRetry("Trying another configured Gemini model for this saved page batch.", { modelIndex, validationAttempt, previous, correction });
        options.onProgress?.({ stage: "code", concept, message: `Retrying the ${concept} page batch with another configured Gemini model. Completed pages are retained.` });
      }
    }
    try {
      const data = payload as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
      if (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== "STOP") throw new Error(`Incomplete code output (${data.candidates[0].finishReason}). Return concise complete pages.`);
      const source = data.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("").trim() || "";
      previous = JSON.parse(source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      const pages = (previous as { pages?: Array<{ path?: unknown; html?: unknown }> })?.pages;
      const problems: string[] = [];
      if (Array.isArray(pages)) {
        problems.push(...paths.filter((path) => !pages.some((page) => page.path === path)).map((path) => `The requested page ${path} is missing.`));
        problems.push(...pages.flatMap((page, index) => [
          ...(!paths.includes(String(page.path)) ? [`Page ${index + 1} must use an exact requested route; received ${String(page.path)}.`] : []),
          ...(typeof page.html === "string" && /href\s*=\s*["'][^"']*\.html/i.test(page.html) ? [`Replace ALL .html links on page ${index + 1} with exact required routes.`] : []),
        ]));
      }
      const input = initial ? previous : { name: design!.code.name, rationale: design!.code.rationale, css: design!.code.css, pages: (previous as { pages?: unknown })?.pages };
      let normalized: WebsiteCodeConcept | undefined;
      try { normalized = options.designOnly ? normalizeWebsiteDesignSystem(input) : normalizeWebsiteCodeBatch(input, spec, profile, paths, preferences); }
      catch (error) { problems.push(error instanceof Error ? error.message : "Invalid page batch."); }
      // Collect grounding and completeness problems together, even when a page is missing.
      // Parsing raw HTML/CSS here is inert; only a fully normalized batch can be accepted.
      const checkedInput = (normalized || input) as WebsiteCodeConcept;
      if (checkedInput && typeof checkedInput.css === "string" && Array.isArray(checkedInput.pages) && checkedInput.pages.every((page) => typeof page?.html === "string")) {
        try {
          const check = runWebsiteQa({ ...spec, code: { schemaVersion: 1, concepts: { editorial: checkedInput, momentum: checkedInput, aura: checkedInput }, validatedAt: new Date().toISOString() } }, profile);
          // Exact batch coverage was checked above; full-site coverage is checked after assembly.
          problems.push(...check.checks.filter((item) => !item.passed && item.key !== "generated-code").map((item) => item.message));
        } catch (error) { problems.push(error instanceof Error ? error.message : "Invalid batch copy."); }
      }
      if (problems.length || !normalized) throw new Error([...new Set(problems)].join(" "));
      return { code: normalized, model: models[modelIndex] };
    } catch (error) {
      correction = error instanceof Error ? error.message.slice(0, 1800) : "Invalid website code.";
      if (validationAttempt) {
        if (options.singleRequest && modelIndex < models.length - 1) throw new WebsiteCodeRetry("Trying another configured Gemini model after page validation.", { modelIndex: modelIndex + 1, validationAttempt: 0 });
        throw new Error(`Gemini could not produce valid ${concept} pages (${paths.join(", ")}). ${correction}`);
      }
      if (!previous) previous = { error: correction };
      if (options.singleRequest) throw new WebsiteCodeRetry("Refining this saved page batch after validation.", { modelIndex, validationAttempt: 1, previous, correction });
      options.onProgress?.({ stage: "code", concept, message: `Refining the ${concept} page batch after validation.` });
    }
  }
  throw new Error("Website generation failed.");
}

async function generateConcept(concept: WebsiteConcept, spec: WebsiteSpec, profile: BusinessProfile, options: Options, completed: (count: number) => void): Promise<WebsiteCodeConcept> {
  const paths = websitePaths(spec);
  let design = await generateBatch(concept, ["/"], spec, profile, options);
  const models = new Set([design.model]);
  const pages = [...design.code.pages];
  completed(1);
  for (let index = 1; index < paths.length; index += PAGE_BATCH_SIZE) {
    const requested = paths.slice(index, index + PAGE_BATCH_SIZE);
    const batch = await generateBatch(concept, requested, spec, profile, options, design);
    models.add(batch.model);
    pages.push(...batch.code.pages);
    design = { model: batch.model, code: { ...batch.code, pages: [pages[0]] } };
    completed(requested.length);
  }
  const code = normalizeWebsiteCodeConcept({ ...design.code, pages }, spec, profile, resolvedWebsitePreferences(options.memory, profile.workspaceId));
  return { ...code, models: [...models] };
}

export async function generateWebsiteCode(spec: WebsiteSpec, profile: BusinessProfile, options: Options = {}): Promise<WebsiteCode> {
  const config = options.config || getGeminiWebsiteConfig();
  if (!config.apiKey) throw new Error("Gemini must be configured before generating website code.");
  if (spec.services.length > 16) throw new Error("This website generation supports up to 16 active services. Split a larger catalogue before generating.");
  const totalPages = websitePaths(spec).length * WEBSITE_CONCEPTS.length;
  let completedPages = 0;
  const report = (progress: WebsiteGenerationProgress) => options.onProgress?.({ ...progress, completedPages, totalPages });
  report({ stage: "code", message: "Designing three original homepages and reusable stylesheets." });
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  // Three concepts run independently. Each has one active small batch, so provider concurrency stays at three.
  const results = await Promise.allSettled(WEBSITE_CONCEPTS.map((concept) => generateConcept(concept, spec, profile, { ...options, config, onProgress: report, signal }, (count) => {
    completedPages += count;
    report({ stage: "code", concept, message: `Building website pages: ${completedPages} of ${totalPages} complete.` });
  }).catch((error) => { if (!controller.signal.aborted) controller.abort(error); throw error; })));
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const concepts = Object.fromEntries(results.map((result, index) => [WEBSITE_CONCEPTS[index], (result as PromiseFulfilledResult<WebsiteCodeConcept>).value])) as WebsiteCode["concepts"];
  const signatures = Object.values(concepts).map((value) => `${value.css}\n${value.pages.find((page) => page.path === "/")?.html}`);
  if (new Set(signatures).size !== 3) throw new Error("Gemini repeated the same website code across concepts. Generate again for distinct designs.");
  const code: WebsiteCode = { schemaVersion: 1, concepts, validatedAt: new Date().toISOString() };
  if (!runWebsiteQa({ ...spec, code }, profile).passed) throw new Error("The completed website did not pass grounding and page coverage checks.");
  if (JSON.stringify(code).length > 900_000) throw new Error("Generated website code exceeded the project storage limit.");
  return code;
}
