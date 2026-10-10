import { z } from "zod";
import * as cssTree from "css-tree";
import { completion, getModels } from "../openrouter";
import { websiteKeyName } from "../api";
import { localPlatformMode, PlatformError } from "../platform/config";
import type { BlueprintDocument, Fact } from "../knowledge/contracts";
export const designSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rationale: z.string().trim().min(10).max(3000),
    navigation: z.enum(["top", "rail"]),
    hero: z.enum(["center", "split", "left"]),
    content: z.enum(["article", "cards", "columns"]),
    css: z.string().min(100).max(60000),
  })
  .strict();
export type Design = z.infer<typeof designSchema>;
export type DesignResult = {
  design: Design;
  model: string;
  usage: unknown;
  mode: "live" | "fixture";
};
export function validateDesign(input: unknown): Design {
  const design = designSchema.parse(input);
  const tree = cssTree.parse(design.css, {
    parseCustomProperty: true,
    onParseError: () => {
      throw new PlatformError(
        "The generated CSS could not be safely parsed.",
        422,
      );
    },
  });
  cssTree.walk(tree, (node) => {
    if (
      node.type === "Url" ||
      node.type === "Raw" ||
      (node.type === "Function" &&
        ["url", "expression"].includes(
          cssTree.ident.decode(node.name).toLowerCase(),
        )) ||
      (node.type === "Atrule" &&
        ["import", "font-face"].includes(
          cssTree.ident.decode(node.name).toLowerCase(),
        )) ||
      (node.type === "Declaration" &&
        ["behavior", "-moz-binding"].includes(
          cssTree.ident.decode(node.property).toLowerCase(),
        ))
    )
      throw new PlatformError(
        "The generated design contains unsupported external or executable CSS.",
        422,
      );
  });
  if (/<\/|javascript\s*:|expression\s*\(/i.test(design.css))
    throw new PlatformError("The generated CSS failed safety checks.", 422);
  return design;
}
export async function createDesign(
  blueprint: BlueprintDocument,
  facts: Fact[],
  slot: number,
  peers: Design[],
  signal?: AbortSignal,
  preferredModel?: string,
): Promise<DesignResult> {
  if (
    localPlatformMode() &&
    process.env.PLATFORM_TEST_OUTPUT === "1" &&
    process.env.PLATFORM_TEST_CRAWL_FIXTURE === "1"
  ) {
    const color = ["#175f51", "#513661", "#254b71"][slot - 1];
    return {
      design: validateDesign({
        name: `Fixture alternative ${slot}`,
        rationale:
          "Deterministic design fixture for exercising the complete compiler and backend.",
        navigation: slot === 2 ? "rail" : "top",
        hero: slot === 1 ? "center" : slot === 2 ? "split" : "left",
        content: slot === 1 ? "article" : slot === 2 ? "cards" : "columns",
        css: `body{background:#fafafa;color:#172323;font-family:${slot === 2 ? "Georgia,serif" : "Arial,sans-serif"}}.site-shell{max-width:1120px;margin:auto;padding:24px}.site-header{border-bottom:3px solid ${color};padding:20px 0}.hero{background:${color};color:white;padding:clamp(24px,5vw,60px);margin:24px 0;border-radius:${slot * 4}px}.source-content{line-height:1.8}.enquiry button{background:${color};color:white;padding:14px;border-radius:8px}`,
      }),
      model: "deterministic-test-fixture",
      usage: null,
      mode: "fixture",
    };
  }
  const key = process.env[websiteKeyName()]?.trim();
  if (!key)
    throw new PlatformError(
      `Website generation needs ${websiteKeyName()} in the server environment.`,
      503,
    );
  const models = await getModels(signal),
    model = preferredModel
      ? models.find((model) => model.id === preferredModel)
      : models[(slot - 1) % models.length];
  if (!model)
    throw new PlatformError(
      "The fixed generation model is no longer available. Create a new build configuration.",
      409,
    );
  const result = await completion(
    key,
    model,
    [
      {
        role: "system",
        content:
          "You design a complete multi-page business website. Return one JSON object with exactly name, rationale, navigation (top|rail), hero (center|split|left), content (article|cards|columns), css. Create an original complete responsive CSS design; no external URLs, imports, fonts, scripts, fabricated claims or hidden source content. Use local system fonts. The trusted application implements routes and working enquiry forms. Style .site-shell .site-header .brand .site-nav .hero .hero-copy .hero-title .page-body .source-content .source-paragraph .page-headings .business-facts .enquiry .site-footer. All approved content is preserved. Make this alternative visually distinct in composition, typography, colors and hierarchy from prior alternatives. Never reduce required pages.",
      },
      {
        role: "user",
        content: JSON.stringify({
          slot,
          facts: facts
            .filter((f) => f.value)
            .map(({ key, value }) => ({ key, value })),
          pages: blueprint.pages
            .filter((p) => p.outcome === "render")
            .map(({ path, title, family }) => ({ path, title, family })),
          priorDesigns: peers.map(
            ({ name, rationale, navigation, hero, content, css }) => ({
              name,
              rationale,
              navigation,
              hero,
              content,
              css: css.slice(0, 8000),
            }),
          ),
        }),
      },
    ],
    signal,
    {
      type: "object",
      additionalProperties: false,
      required: ["name", "rationale", "navigation", "hero", "content", "css"],
      properties: {
        name: { type: "string" },
        rationale: { type: "string" },
        navigation: { type: "string", enum: ["top", "rail"] },
        hero: { type: "string", enum: ["center", "split", "left"] },
        content: { type: "string", enum: ["article", "cards", "columns"] },
        css: { type: "string" },
      },
    },
  );
  let data: unknown;
  try {
    data = JSON.parse(
      result.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw new PlatformError(
      "The design provider returned invalid structured output. Retry this build.",
      503,
    );
  }
  return {
    design: validateDesign(data),
    model: result.model,
    usage: result.usage ?? null,
    mode: "live",
  };
}
