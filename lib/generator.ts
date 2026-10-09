import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  directionSchema,
  type Artifact,
  type Model,
  type SitePage,
  type SitePagePlan,
  type Discovery,
  type Knowledge,
  type PhotoAsset,
} from "./types";
import {
  completion,
  getModels,
  ProviderError,
  resolveModelId,
} from "./openrouter";
import {
  planPrompt,
  sitePagePrompt,
  sitePagesPlanPrompt,
  websitePrompt,
} from "./prompts";
import { HOME_PAGE, MAX_EXTRA_PAGES, PAGE_SLUG } from "./site-pages";
import { validateWebsite } from "./validation";
import { inspectWebsite } from "./visual-check";
import { prepareMedia } from "./pexels";

// Leaves room for one validation repair or a fallback model inside the route's maxDuration.
const GENERATION_BUDGET_MS = 285000;

const planSchema = z.object({
  directions: z
    .array(
      directionSchema.extend({
        imageQueries: z.array(z.string().trim().min(3).max(160)).min(1).max(2),
      }),
    )
    .length(3),
});
export async function makePlan(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  signal?: AbortSignal,
) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(GENERATION_BUDGET_MS)])
    : AbortSignal.timeout(GENERATION_BUDGET_MS);
  const models = await getModels(signal);
  let lastError: unknown;
  for (const model of models.slice(0, 3)) {
    try {
      const result = await completion(
        key,
        model,
        await planPrompt(knowledge, discovery),
        signal,
        z.toJSONSchema(planSchema),
      );
      const raw = result.content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const data = planSchema.parse(JSON.parse(raw));
      if (new Set(data.directions.map((d) => d.name.toLowerCase())).size !== 3)
        throw new Error("The model must create three distinct named concepts.");
      if (
        new Set(data.directions.map((d) => d.composition.toLowerCase()))
          .size !== 3 ||
        new Set(data.directions.map((d) => d.concept.toLowerCase())).size !== 3
      )
        throw new Error(
          "Each design direction must have its own concept and composition.",
        );
      const media = await Promise.all(
        data.directions.map((d) => prepareMedia(d.imageQueries, signal)),
      );
      return { ...data, model: result.model, media };
    } catch (error) {
      lastError = error;
      if (
        signal?.aborted ||
        (error instanceof ProviderError && [401, 402].includes(error.status))
      )
        throw error;
    }
  }
  throw lastError;
}
type Messages = { role: string; content: string }[];
// Shared generate -> validate -> inspect -> repair loop with configured-model fallback.
async function generateDocument(
  key: string,
  candidates: Model[],
  buildMessages: () => Promise<Messages>,
  check: (content: string) => Promise<{ html: string; warnings: string[] }>,
  signal: AbortSignal,
  onProgress?: (message: string) => void,
  onInvalidOutput?: (html: string) => Promise<void>,
) {
  let lastError: unknown;
  for (const model of candidates) {
    const messages = await buildMessages();
    for (let repair = 0; repair < 2; repair++) {
      onProgress?.(`${model.id}: ${repair ? "repairing" : "generating"}`);
      try {
        const result = await completion(key, model, messages, signal);
        onProgress?.(
          `${model.id}: received ${result.content.length} characters; checking the document`,
        );
        try {
          const checked = await check(result.content);
          return { ...checked, model: result.model, usage: result.usage };
        } catch (error) {
          onProgress?.(
            `Validation: ${error instanceof Error ? error.message : "Invalid website"}`,
          );
          await onInvalidOutput?.(result.content);
          lastError = error;
          messages.push(
            { role: "assistant", content: result.content },
            {
              role: "user",
              content: `Correct this validation failure and return the entire revised HTML document: ${error instanceof Error ? error.message : "Invalid website"}`,
            },
          );
        }
      } catch (error) {
        onProgress?.(
          `Provider: ${error instanceof Error ? error.message : "Request failed"}`,
        );
        lastError = error;
        if (
          signal.aborted ||
          (error instanceof ProviderError && [401, 402].includes(error.status))
        )
          throw error;
        break;
      }
    }
  }
  throw lastError;
}
function withBudget(signal?: AbortSignal) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(GENERATION_BUDGET_MS)])
    : AbortSignal.timeout(GENERATION_BUDGET_MS);
}
async function candidateModels(
  index: number,
  signal: AbortSignal,
  selectedModel?: string,
) {
  const models = await getModels(signal);
  const preferred = selectedModel
    ? models.find((m) => m.id === resolveModelId(selectedModel))
    : models[index % models.length];
  if (selectedModel && !preferred)
    throw new Error(
      "Choose an available configured website model from Generation settings.",
    );
  return [preferred!, ...models.filter((m) => m.id !== preferred!.id)].slice(
    0,
    3,
  );
}
async function checkDocument(
  content: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  photos: PhotoAsset[],
  signal: AbortSignal,
  options: {
    previousHtml?: string[];
    unchangedHtml?: string;
    pageSlugs?: string[];
    subpage?: boolean;
  } = {},
) {
  const validated = validateWebsite(
    content,
    knowledge,
    options.previousHtml ?? [],
    discovery,
    photos,
    { pageSlugs: options.pageSlugs, subpage: options.subpage },
  );
  if (options.unchangedHtml && validated.html === options.unchangedHtml)
    throw new Error(
      "The requested change was not applied. Return an updated full document.",
    );
  const inspection = await inspectWebsite(
    validated.html,
    signal,
    validated.photoCredits,
  );
  if (inspection.errors.length) throw new Error(inspection.errors.join(" "));
  return {
    html: validated.html,
    warnings: [...validated.warnings, ...inspection.warnings],
  };
}
const nextEdits = (
  edits: { prompt: string; createdAt: string }[] | undefined,
  prompt: string,
) => [
  ...(edits ?? []).slice(-19),
  { prompt, createdAt: new Date().toISOString() },
];
export async function makeWebsite(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  direction: z.infer<typeof directionSchema>,
  index: number,
  previous: Artifact[],
  signal?: AbortSignal,
  selectedModel?: string,
  photos: PhotoAsset[] = [],
  refinement?: { artifact: Artifact; prompt: string; pageSlugs?: string[] },
  onProgress?: (message: string) => void,
  onInvalidOutput?: (html: string) => Promise<void>,
): Promise<Artifact> {
  const budget = withBudget(signal);
  const result = await generateDocument(
    key,
    await candidateModels(index, budget, selectedModel),
    () =>
      websitePrompt(
        knowledge,
        discovery,
        direction,
        previous,
        photos,
        refinement,
      ),
    (content) =>
      checkDocument(content, knowledge, discovery, photos, budget, {
        previousHtml: previous.map((p) => p.html),
        unchangedHtml: refinement?.artifact.html,
        pageSlugs:
          refinement?.pageSlugs ??
          refinement?.artifact.pages?.map((p) => p.slug),
      }),
    budget,
    onProgress,
    onInvalidOutput,
  );
  const id = randomUUID();
  return {
    id,
    designId: refinement
      ? (refinement.artifact.designId ?? refinement.artifact.id)
      : id,
    index,
    name: direction.name,
    rationale: `${direction.concept}\n${direction.composition}`,
    html: result.html,
    model: result.model,
    usage: result.usage,
    warnings: result.warnings,
    createdAt: new Date().toISOString(),
    direction,
    photos,
    edits: refinement
      ? nextEdits(refinement.artifact.edits, refinement.prompt)
      : [],
  };
}

const sitePagesSchema = z.object({
  pages: z
    .array(
      z.object({
        slug: z.string().trim().toLowerCase().regex(PAGE_SLUG),
        title: z.string().trim().min(2).max(40),
        purpose: z.string().trim().min(10).max(600),
      }),
    )
    .min(1)
    .max(MAX_EXTRA_PAGES),
});
/** Chooses the inner pages for a version from the source site and owner knowledge. */
export async function planSitePages(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  home: Artifact,
  signal?: AbortSignal,
): Promise<SitePagePlan[]> {
  const budget = withBudget(signal);
  const models = await getModels(budget);
  let lastError: unknown;
  for (const model of models.slice(0, 3)) {
    try {
      const result = await completion(
        key,
        model,
        await sitePagesPlanPrompt(knowledge, discovery, home.html),
        budget,
        z.toJSONSchema(sitePagesSchema),
      );
      const raw = result.content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const pages = sitePagesSchema
        .parse(JSON.parse(raw))
        .pages.filter((p) => p.slug !== HOME_PAGE);
      const unique = pages.filter(
        (p, i) => pages.findIndex((q) => q.slug === p.slug) === i,
      );
      if (!unique.length)
        throw new Error("The model proposed no usable inner pages.");
      return unique;
    } catch (error) {
      lastError = error;
      if (
        budget.aborted ||
        (error instanceof ProviderError && [401, 402].includes(error.status))
      )
        throw error;
    }
  }
  throw lastError;
}
/** Builds (or, with `refinement`, edits) one inner page in the home page's design. */
export async function makeSitePage(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  home: Artifact,
  sitePages: SitePagePlan[],
  page: SitePagePlan,
  signal?: AbortSignal,
  selectedModel?: string,
  refinement?: { page: SitePage; prompt: string },
  onProgress?: (message: string) => void,
): Promise<SitePage> {
  const budget = withBudget(signal);
  const position = sitePages.findIndex((p) => p.slug === page.slug);
  const photos = home.photos ?? [];
  const result = await generateDocument(
    key,
    // Spread pages across configured models (separate per-model rate limits).
    await candidateModels(Math.max(position, 0), budget, selectedModel),
    () =>
      sitePagePrompt(
        knowledge,
        discovery,
        home,
        sitePages,
        page,
        photos,
        refinement,
      ),
    (content) =>
      checkDocument(content, knowledge, discovery, photos, budget, {
        unchangedHtml: refinement?.page.html,
        pageSlugs: sitePages.map((p) => p.slug),
        subpage: true,
      }),
    budget,
    onProgress,
  );
  return {
    slug: page.slug,
    title: page.title,
    purpose: page.purpose,
    html: result.html,
    model: result.model,
    warnings: result.warnings,
    createdAt: new Date().toISOString(),
    edits: refinement
      ? nextEdits(refinement.page.edits, refinement.prompt)
      : [],
  };
}
