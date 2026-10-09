"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileStack,
  Globe2,
  Layers3,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  emptyKnowledge,
  knowledgeSchema,
  knowledgeDraftSchema,
  type Artifact,
  type DesignPlan,
  type Discovery,
  type Knowledge,
  type SitePagePlan,
} from "@/lib/types";
import {
  HOME_PAGE,
  downloadedPageLinks,
  hideImageCaptions,
  servedPageLinks,
  zipFiles,
} from "@/lib/site-pages";
import { readDraft, saveDraft } from "@/lib/browser-store";
import { AssistantEmbed } from "./assistant-embed";
import { BookingPanel } from "./booking-panel";

type ModelOption = { id: string; name: string; context: number };
class StudioRequestError extends Error {
  constructor(
    message: string,
    public latestArtifact?: Artifact,
  ) {
    super(message);
  }
}
type DiscoveryEvent = {
  type: string;
  message?: string;
  discovery?: Discovery;
  pages?: Discovery["pages"];
};
const fileName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "website";
// Combines concurrent "Build full site" responses: home fields from the home-link
// response (if any), and the newest copy of each planned page from any response.
function mergeSiteBuild(
  base: Artifact,
  responses: Artifact[],
  planned: string[],
): Artifact {
  const home = responses.find((a) => a.id !== base.id) ?? base;
  const pages = new Map<string, NonNullable<Artifact["pages"]>[number]>();
  for (const artifact of [base, ...responses])
    for (const page of artifact.pages ?? []) {
      const known = pages.get(page.slug);
      if (!known || known.createdAt < page.createdAt)
        pages.set(page.slug, page);
    }
  const kept = [...pages.values()].filter(
    (p) => !responses.length || planned.includes(p.slug),
  );
  return {
    ...home,
    pages: planned.length
      ? planned.flatMap((slug) => kept.filter((p) => p.slug === slug))
      : kept,
  };
}
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}
const normalizeUrl = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).href;
  } catch {
    return url;
  }
};
const download = (
  content: string | Uint8Array<ArrayBuffer>,
  name: string,
  type: string,
) => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function Studio() {
  const [knowledge, setKnowledge] = useState<Knowledge>(emptyKnowledge);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [plan, setPlan] = useState<DesignPlan | null>(null);
  const [generatedFrom, setGeneratedFrom] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState("Saved on this device");
  const [accessToken, setAccessToken] = useState("");
  const [serverConfigured, setServerConfigured] = useState(false);
  const [tokenRequired, setTokenRequired] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelChoices, setModelChoices] = useState(["", "", ""]);
  const [settings, setSettings] = useState(false);
  const [tab, setTab] = useState<"knowledge" | "designs">("knowledge");
  const [busy, setBusy] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [status, setStatus] = useState("");
  const [crawlStatus, setCrawlStatus] = useState("");
  const [crawlError, setCrawlError] = useState("");
  const [error, setError] = useState("");
  const [variantErrors, setVariantErrors] = useState<Record<number, string>>(
    {},
  );
  const [skipWebsite, setSkipWebsite] = useState(false);
  const [selected, setSelected] = useState(0);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [changePrompts, setChangePrompts] = useState<Record<number, string>>(
    {},
  );
  // Per version: the page shown in the preview, and the last "Build full site" plan.
  const [selectedPages, setSelectedPages] = useState<Record<number, string>>(
    {},
  );
  const [sitePlans, setSitePlans] = useState<
    Record<number, { pages: SitePagePlan[]; failed: string[] }>
  >({});
  const buildController = useRef<AbortController | null>(null);
  const crawlController = useRef<AbortController | null>(null);
  const crawlPromise = useRef<{
    url: string;
    promise: Promise<Discovery>;
  } | null>(null);
  const lastAttempt = useRef("");
  const latestKnowledge = useRef(knowledge);
  latestKnowledge.current = knowledge;
  const latestDiscovery = useRef(discovery);
  latestDiscovery.current = discovery;
  const pauseCrawl = useRef(false);

  useEffect(() => {
    let mounted = true;
    readDraft()
      .then((draft) => {
        if (!mounted) return;
        if (draft?.version === 1) {
          const parsed = knowledgeDraftSchema.safeParse(draft.knowledge);
          if (parsed.success) {
            setKnowledge(parsed.data);
            setDiscovery(draft.discovery);
            setArtifacts(draft.artifacts ?? []);
            setPlan(draft.plan);
            setGeneratedFrom(draft.generatedFrom ?? "");
            setChangePrompts(
              Object.fromEntries(
                [0, 1, 2].flatMap((index) => {
                  const value = draft.changePrompts?.[index];
                  return typeof value === "string"
                    ? [[index, value.slice(0, 6000)]]
                    : [];
                }),
              ),
            );
          }
        }
      })
      .catch(() => {
        if (mounted) setSaving("Device storage is unavailable");
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setModels(data.models);
        setServerConfigured(data.serverKeyConfigured);
        setTokenRequired(data.accessTokenRequired);
      })
      .catch(() => {
        if (mounted)
          setError(
            "Could not load the configured website models. Refresh the page to try again.",
          );
      });
    return () => {
      mounted = false;
      buildController.current?.abort();
      crawlController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      saveDraft({
        version: 1,
        knowledge,
        discovery,
        artifacts,
        plan,
        generatedFrom,
        changePrompts,
      })
        .then(() => setSaving("Saved on this device"))
        .catch(() =>
          setSaving("Could not save on this device — download your knowledge"),
        );
    }, 450);
    return () => clearTimeout(timer);
  }, [
    ready,
    knowledge,
    discovery,
    artifacts,
    plan,
    generatedFrom,
    changePrompts,
  ]);

  const discover = useCallback(
    async (url: string, force = false, extend = false): Promise<Discovery> => {
      if (!force && crawlPromise.current?.url === normalizeUrl(url))
        return crawlPromise.current.promise;
      crawlController.current?.abort();
      const controller = new AbortController();
      crawlController.current = controller;
      pauseCrawl.current = false;
      setCrawling(true);
      setCrawlError("");
      setCrawlStatus("Finding website pages…");
      const prior = latestDiscovery.current;
      let result: Discovery | undefined =
        !force && prior && normalizeUrl(prior.inputUrl) === normalizeUrl(url)
          ? prior
          : undefined;
      const promise = (async () => {
        try {
          let first = true;
          do {
            const beforeCount = result?.pages.length ?? 0;
            const response = await fetch("/api/discover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                url,
                capturedCount: result?.pages.length ?? 0,
                ...(result?.crawl
                  ? { crawlId: result.crawl.id, extend: first && extend }
                  : result
                    ? { previous: result }
                    : {}),
              }),
            });
            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error ?? "Could not read website.");
            }
            const reader = response.body?.getReader();
            if (!reader)
              throw new Error("Website discovery did not return a response.");
            const decoder = new TextDecoder();
            let buffer = "",
              completed = false;
            const handle = (line: string) => {
              if (!line.trim()) return;
              const event: DiscoveryEvent = JSON.parse(line);
              if (event.type === "progress")
                setCrawlStatus(event.message ?? "");
              if (event.type === "error") throw new Error(event.message);
              if (
                (event.type === "checkpoint" || event.type === "result") &&
                event.discovery
              ) {
                const pages =
                  event.pages !== undefined
                    ? [
                        ...new Map(
                          [...(result?.pages ?? []), ...event.pages].map(
                            (page) => [page.url, page],
                          ),
                        ).values(),
                      ]
                    : event.discovery.pages;
                result = { ...event.discovery, pages };
                if (
                  normalizeUrl(latestKnowledge.current.websiteUrl) ===
                  normalizeUrl(url)
                ) {
                  latestDiscovery.current = result;
                  setDiscovery(result);
                  setCrawlStatus(`${result.pages.length} pages saved`);
                }
              }
              if (event.type === "result") completed = true;
            };
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) handle(line);
              }
              if (buffer) handle(buffer);
            } finally {
              await reader.cancel().catch(() => {});
            }
            if (!completed || !result)
              throw new Error(
                "Discovery was interrupted. Saved pages can be used or resumed.",
              );
            first = false;
            if (pauseCrawl.current || result.pages.length === beforeCount)
              break;
          } while (result?.crawl?.canContinue && !controller.signal.aborted);
          return result!;
        } catch (error) {
          if (controller.signal.aborted && result?.pages.length) {
            setCrawlStatus(
              `${result.pages.length} pages saved. Discovery paused.`,
            );
            return result;
          }
          if (!controller.signal.aborted) {
            setCrawlError(
              error instanceof Error
                ? error.message
                : "Could not read this website.",
            );
            setCrawlStatus("");
          }
          throw error;
        } finally {
          if (crawlController.current === controller) {
            setCrawling(false);
            crawlPromise.current = null;
          }
        }
      })();
      crawlPromise.current = { url: normalizeUrl(url), promise };
      return promise;
    },
    [],
  );
  useEffect(() => {
    if (!ready || busy || skipWebsite || !knowledge.websiteUrl.trim()) return;
    const url = normalizeUrl(knowledge.websiteUrl.trim());
    if (
      (discovery && normalizeUrl(discovery.inputUrl) === url) ||
      lastAttempt.current === url
    )
      return;
    if (!/^https?:\/\/[^/]+\.[^/]+/.test(url)) return;
    const timer = setTimeout(() => {
      lastAttempt.current = url;
      void discover(knowledge.websiteUrl.trim()).catch(() => {});
    }, 1700);
    return () => clearTimeout(timer);
  }, [ready, busy, skipWebsite, knowledge.websiteUrl, discovery, discover]);
  const headers = () => ({
    "Content-Type": "application/json",
    ...(accessToken ? { "x-studio-token": accessToken } : {}),
  });
  async function post<T>(
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json();
    if (!response.ok || data.error)
      throw new StudioRequestError(
        data.error ?? "Request failed.",
        response.status === 409 ? data.latestArtifact : undefined,
      );
    return data;
  }

  async function generate(event?: FormEvent, retryIndex?: number) {
    event?.preventDefault();
    setError("");
    const parsed = knowledgeSchema.safeParse(knowledge);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setTab("knowledge");
      return;
    }
    if (!serverConfigured) {
      setError(
        "Website generation is not connected yet. Ask the studio administrator to configure it.",
      );
      return;
    }
    if (tokenRequired && !accessToken) {
      setSettings(true);
      setError(
        "Enter the studio access token to use the configured server key.",
      );
      return;
    }
    const controller = new AbortController();
    buildController.current = controller;
    setBusy(true);
    setVariantErrors({});
    const snapshot = parsed.data;
    try {
      let source: Discovery | null = null;
      if (snapshot.websiteUrl && !skipWebsite) {
        pauseCrawl.current = true;
        const pending =
          crawlPromise.current?.url === normalizeUrl(snapshot.websiteUrl)
            ? crawlPromise.current.promise
            : null;
        if (pending) {
          crawlController.current?.abort();
          source = await pending;
        }
        setStatus("Reading your existing website…");
        source ??=
          discovery &&
          normalizeUrl(discovery.inputUrl) === normalizeUrl(snapshot.websiteUrl)
            ? discovery
            : await discover(snapshot.websiteUrl);
      }
      controller.signal.throwIfAborted();
      const fingerprint = JSON.stringify({
        knowledge: snapshot,
        source: source?.crawl?.revision ?? source?.crawledAt ?? null,
      });
      const canResume =
        plan &&
        generatedFrom === fingerprint &&
        (retryIndex !== undefined || artifacts.length < 3);
      let currentPlan = canResume ? plan : null;
      let accepted = canResume
        ? artifacts.filter((a) => a.index !== retryIndex)
        : [];
      if (!currentPlan) {
        setStatus("Creating three original design directions…");
        currentPlan = await post<DesignPlan>(
          "/api/plan",
          {
            knowledge: snapshot,
            ...(source?.crawl
              ? { discoveryId: source.crawl.id }
              : { discovery: source }),
          },
          controller.signal,
        );
        setPlan(currentPlan);
        setGeneratedFrom(fingerprint);
        setArtifacts([]);
      }
      setTab("designs");
      const indexes =
        retryIndex !== undefined && canResume
          ? [retryIndex]
          : [0, 1, 2].filter(
              (index) => !accepted.some((a) => a.index === index),
            );
      if (!indexes.length) indexes.push(0, 1, 2);
      // Versions are independent (the plan already makes directions distinct), so generate
      // them concurrently: total wait is the slowest version, not the sum of all three.
      const activePlan = currentPlan;
      const previous = accepted;
      setSelected(indexes[0]);
      setStatus(
        indexes.length === 1
          ? `Designing ${indexes[0] + 1} of 3 — ${activePlan.directions[indexes[0]].name}…`
          : `Designing ${indexes.length} versions in parallel…`,
      );
      await Promise.all(
        indexes.map(async (index) => {
          try {
            const response = await post<{ artifact: Artifact }>(
              "/api/generate",
              {
                knowledge: snapshot,
                ...(activePlan.sourceSnapshotId
                  ? { sourceSnapshotId: activePlan.sourceSnapshotId }
                  : source?.crawl
                    ? { discoveryId: source.crawl.id }
                    : { discovery: source }),
                direction: activePlan.directions[index],
                index,
                previous: previous.filter((a) => a.index !== index).slice(0, 2),
                photoIds:
                  activePlan.media?.[index]?.photos.map((p) => p.id) ?? [],
                ...(modelChoices[index] ? { model: modelChoices[index] } : {}),
              },
              controller.signal,
            );
            accepted = [
              ...accepted.filter((a) => a.index !== index),
              response.artifact,
            ].sort((a, b) => a.index - b.index);
            setArtifacts(accepted);
            setVariantErrors((old) => {
              const next = { ...old };
              delete next[index];
              return next;
            });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            setVariantErrors((old) => ({
              ...old,
              [index]:
                error instanceof Error
                  ? error.message
                  : "This version could not be generated.",
            }));
          }
        }),
      );
      setStatus(
        accepted.length === 3
          ? "All three designs are ready. Choose one and click Build full site to create its other pages."
          : `${accepted.length} of 3 designs ready. Retry any unfinished version.`,
      );
      if (accepted.length) setSelected(accepted[0].index);
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus("Generation stopped. Completed designs are saved.");
      } else {
        setError(error instanceof Error ? error.message : "Generation failed.");
        setStatus("");
      }
    } finally {
      setBusy(false);
      buildController.current = null;
    }
  }
  async function refine(event: FormEvent) {
    event.preventDefault();
    if (busy || !current?.path) return;
    setError("");
    if (!serverConfigured) {
      setError("Configure website generation before applying changes.");
      return;
    }
    if (tokenRequired && !accessToken) {
      setSettings(true);
      setError("Enter the studio access token to apply changes.");
      return;
    }
    const prompt = (changePrompts[selected] ?? "").trim();
    if (prompt.length < 3) {
      setError("Describe the change you want.");
      return;
    }
    const parts = current.path.split("/");
    const targetIndex = current.index;
    const page = currentPage;
    const controller = new AbortController();
    buildController.current = controller;
    setBusy(true);
    setStatus(
      `Applying changes to version ${targetIndex + 1}${page ? ` — ${page.title} page` : ""}…`,
    );
    try {
      const result = await post<{ artifact: Artifact }>(
        "/api/refine",
        {
          business: decodeURIComponent(parts[2]),
          version: parts[3],
          revision: current.id,
          prompt,
          ...(page ? { page: page.slug } : {}),
          ...(modelChoices[targetIndex]
            ? { model: modelChoices[targetIndex] }
            : {}),
        },
        controller.signal,
      );
      setArtifacts((old) =>
        old.map((a) => (a.index === targetIndex ? result.artifact : a)),
      );
      setChangePrompts((old) => ({ ...old, [targetIndex]: "" }));
      setStatus(
        `Changes applied to version ${targetIndex + 1}${page ? ` — ${page.title} page` : ""}. Your website link is updated.`,
      );
    } catch (error) {
      if (controller.signal.aborted)
        setStatus(
          "Editing stopped. Your last accepted design is still available.",
        );
      else {
        setError(
          error instanceof Error ? error.message : "Could not apply changes.",
        );
        if (
          error instanceof StudioRequestError &&
          error.latestArtifact?.index === targetIndex &&
          error.latestArtifact.path === current.path
        ) {
          const latest = error.latestArtifact;
          setArtifacts((old) =>
            old.map((a) => (a.index === targetIndex ? latest : a)),
          );
        }
        setStatus("");
      }
    } finally {
      setBusy(false);
      buildController.current = null;
    }
  }
  // "Build full site": plan inner pages, then build each page and link them from the
  // home page concurrently. `retry` rebuilds only the failed targets of the last plan.
  async function buildSite(retry = false) {
    if (busy || !current?.path) return;
    setError("");
    if (!serverConfigured) {
      setError("Configure website generation before building pages.");
      return;
    }
    if (tokenRequired && !accessToken) {
      setSettings(true);
      setError("Enter the studio access token to build pages.");
      return;
    }
    const base = current;
    const parts = base.path!.split("/");
    const identity = {
      business: decodeURIComponent(parts[2]),
      version: parts[3],
      revision: base.id,
    };
    const targetIndex = base.index;
    const model = modelChoices[targetIndex] || undefined;
    const controller = new AbortController();
    buildController.current = controller;
    setBusy(true);
    try {
      let pages = retry ? sitePlans[targetIndex]?.pages : undefined;
      let targets = retry ? sitePlans[targetIndex]?.failed : undefined;
      if (!pages?.length || !targets?.length) {
        setStatus("Choosing pages from your business knowledge and website…");
        pages = (
          await post<{ pages: SitePagePlan[] }>(
            "/api/site-pages/plan",
            identity,
            controller.signal,
          )
        ).pages;
        targets = [...pages.map((p) => p.slug), HOME_PAGE];
      }
      const plannedPages = pages;
      const planned = plannedPages.map((p) => p.slug);
      setSitePlans((old) => ({
        ...old,
        [targetIndex]: { pages: plannedPages, failed: [] },
      }));
      setStatus(
        `Building ${plannedPages.length} pages in your chosen design: ${plannedPages.map((p) => p.title).join(", ")}…`,
      );
      const responses: Artifact[] = [];
      const failed: string[] = [];
      const errors: string[] = [];
      let finished = 0;
      // Each page build runs a Chromium layout check; cap how many run at once.
      await mapWithConcurrency(targets, 5, async (target) => {
        try {
          const { artifact } = await post<{ artifact: Artifact }>(
            "/api/site-pages/build",
            {
              ...identity,
              pages: plannedPages,
              target,
              ...(model ? { model } : {}),
            },
            controller.signal,
          );
          responses.push(artifact);
          setStatus(
            `Building ${plannedPages.length} pages in your chosen design… ${++finished} of ${targets.length} done`,
          );
          const merged = mergeSiteBuild(base, responses, planned);
          setArtifacts((old) =>
            old.map((a) => (a.index === targetIndex ? merged : a)),
          );
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failed.push(target);
          const title =
            target === HOME_PAGE
              ? "Home page links"
              : (plannedPages.find((p) => p.slug === target)?.title ?? target);
          errors.push(
            `${title}: ${error instanceof Error ? error.message : "failed"}`,
          );
        }
      });
      setSitePlans((old) => ({
        ...old,
        [targetIndex]: { pages: plannedPages, failed },
      }));
      if (failed.length) {
        setError(
          `Some pages could not be built. Use "Retry missing pages". ${errors.join(" ")}`,
        );
        setStatus(
          `Built ${targets.length - failed.length} of ${targets.length} parts of the site.`,
        );
      } else
        setStatus(
          `Full site ready: Home, ${plannedPages.map((p) => p.title).join(", ")}.`,
        );
    } catch (error) {
      if (controller.signal.aborted)
        setStatus("Page building stopped. Finished pages are saved.");
      else {
        setError(
          error instanceof Error ? error.message : "Could not build the site.",
        );
        setStatus("");
      }
    } finally {
      setBusy(false);
      buildController.current = null;
    }
  }
  const update = (key: keyof Knowledge, value: string) => {
    setKnowledge((old) => ({ ...old, [key]: value }));
    if (key === "websiteUrl") {
      setSkipWebsite(false);
      setCrawlError("");
      crawlController.current?.abort();
    }
  };
  const field = (
    key: keyof Knowledge,
    label: string,
    placeholder: string,
    options: {
      wide?: boolean;
      type?: string;
      rows?: number;
      required?: boolean;
    } = {},
  ) => (
    <label className={`field ${options.wide ? "wide" : ""}`}>
      <span>
        {label}
        {options.required ? (
          <b className="required-badge">Required</b>
        ) : (
          <small>Optional</small>
        )}
      </span>
      {options.rows ? (
        <textarea
          required={options.required}
          rows={options.rows}
          value={String(knowledge[key])}
          placeholder={placeholder}
          onChange={(e) => update(key, e.target.value)}
        />
      ) : (
        <input
          required={options.required}
          maxLength={3000}
          type={options.type ?? "text"}
          value={String(knowledge[key])}
          placeholder={placeholder}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </label>
  );
  const current = artifacts.find((a) => a.index === selected);
  const currentPage = current?.pages?.find(
    (p) => p.slug === selectedPages[selected],
  );
  const builtSlugs = (current?.pages ?? []).map((p) => p.slug);
  const shownHtml = current
    ? hideImageCaptions(
        servedPageLinks(
          (currentPage ?? current).html,
          current.path ?? "",
          builtSlugs,
        ),
      )
    : "";
  const shownPath =
    current?.path && currentPage
      ? `${current.path}/${currentPage.slug}`
      : current?.path;
  const pendingRetry = sitePlans[selected]?.failed.length ?? 0;
  function downloadSite(artifact: Artifact) {
    const name = fileName(artifact.name);
    if (!artifact.pages?.length)
      return download(
        hideImageCaptions(artifact.html),
        `${name}.html`,
        "text/html",
      );
    const slugs = artifact.pages.map((p) => p.slug);
    download(
      zipFiles([
        {
          name: "index.html",
          content: hideImageCaptions(downloadedPageLinks(artifact.html, slugs)),
        },
        ...artifact.pages.map((p) => ({
          name: `${p.slug}.html`,
          content: hideImageCaptions(downloadedPageLinks(p.html, slugs)),
        })),
      ]),
      `${name}.zip`,
      "application/zip",
    );
  }
  const source =
    discovery &&
    normalizeUrl(discovery.inputUrl) === normalizeUrl(knowledge.websiteUrl)
      ? discovery
      : null;
  const changed = Boolean(
    generatedFrom &&
    generatedFrom !==
      JSON.stringify({
        knowledge: knowledgeSchema.safeParse(knowledge).success
          ? knowledgeSchema.parse(knowledge)
          : knowledge,
        source: skipWebsite
          ? null
          : (source?.crawl?.revision ?? source?.crawledAt ?? null),
      }),
  );
  const phones = [...new Set(source?.pages.flatMap((p) => p.phones) ?? [])];
  const emails = [...new Set(source?.pages.flatMap((p) => p.emails) ?? [])];
  return (
    <div className="studio">
      <header className="topbar">
        <a className="brand" href="/" aria-label="EverOnn Website Studio">
          <span className="brand-mark">e</span>everonn
          <span className="brand-dot">.</span>
          <span className="brand-product">Website Studio</span>
        </a>
        <div className="top-actions">
          <span className="save-status">
            <span />
            {ready ? saving : "Opening your draft…"}
          </span>
          <button
            className="icon-button settings-button"
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
          >
            <Settings2 size={16} />
            Generation settings
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> FROM KNOWLEDGE TO WEBSITE
            </div>
            <h1>Your business. Three new perspectives.</h1>
            <p>
              Tell us what you do. Give your next website a better beginning.
            </p>
          </div>
          <div className="heading-mark" aria-hidden="true">
            <Layers3 size={36} strokeWidth={1} />
          </div>
        </div>
        {settings && (
          <section className="settings-panel" aria-label="Generation settings">
            <div className="panel-title">
              <h2>Generation settings</h2>
              <button
                className="icon-button"
                aria-label="Close generation settings"
                onClick={() => setSettings(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="form-grid">
              {tokenRequired && (
                <label className="field">
                  <span>
                    Studio access token<small>For the server key</small>
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Your studio access token"
                  />
                </label>
              )}
              <div className="model-options wide">
                {[0, 1, 2].map((index) => (
                  <label className="field" key={index}>
                    <span>Version {index + 1} model</span>
                    <select
                      value={modelChoices[index]}
                      onChange={(e) =>
                        setModelChoices((old) =>
                          old.map((v, i) => (i === index ? e.target.value : v)),
                        )
                      }
                    >
                      <option value="">Automatic · configured models</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <p className="help-text">
              Versions use the configured models in order, with fallback within
              that list. Claude, Gemini Pro and GPT use paid OpenRouter credits.
            </p>
          </section>
        )}
        <div
          className="workspace-tabs"
          role="tablist"
          aria-label="Studio views"
        >
          <button
            id="knowledge-tab"
            role="tab"
            aria-selected={tab === "knowledge"}
            aria-controls="knowledge-panel"
            className={tab === "knowledge" ? "active" : ""}
            onClick={() => setTab("knowledge")}
          >
            <span>01</span>Business knowledge
          </button>
          <button
            id="designs-tab"
            role="tab"
            aria-selected={tab === "designs"}
            aria-controls="designs-panel"
            className={tab === "designs" ? "active" : ""}
            onClick={() => setTab("designs")}
          >
            <span>02</span>Your designs
            {artifacts.length > 0 && <b>{artifacts.length}/3</b>}
          </button>
          <div className="tabs-note">
            <Sparkles size={14} /> Original design, every time
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {busy && (
          <div className="generation-progress" role="status">
            <Loader2 size={18} className="spin" />
            <span>{status}</span>
            <button
              onClick={() => {
                buildController.current?.abort();
                crawlController.current?.abort();
              }}
            >
              Stop
            </button>
          </div>
        )}
        <div
          hidden={tab !== "knowledge"}
          id="knowledge-panel"
          role="tabpanel"
          aria-labelledby="knowledge-tab"
        >
          <form onSubmit={(e) => void generate(e)} className="knowledge-layout">
            <div className="knowledge-main">
              <section className="panel">
                <div className="section-heading">
                  <div className="section-number">01</div>
                  <div>
                    <h2>The essentials</h2>
                    <p>
                      Add your business name, type and description. Other
                      details are optional.
                    </p>
                  </div>
                  <span className="required-note">Three required fields</span>
                </div>
                <fieldset disabled={busy || !ready}>
                  <div className="form-grid">
                    {field(
                      "businessName",
                      "Business name",
                      "e.g. Northline Heating & Air",
                      { required: true },
                    )}
                    {field(
                      "businessType",
                      "Business type",
                      "e.g. Residential & commercial HVAC",
                      { required: true },
                    )}
                    {field(
                      "industry",
                      "Industry intelligence",
                      "e.g. HVAC · Heating & cooling",
                      { wide: true },
                    )}
                    <label className="field wide description-field">
                      <span>
                        Description<b className="required-badge">Required</b>
                      </span>
                      <textarea
                        required
                        rows={6}
                        maxLength={20000}
                        value={knowledge.description}
                        onChange={(e) => update("description", e.target.value)}
                        placeholder="Describe your business, who you help, and what makes your work special. Include anything you want your new website to communicate."
                      />
                      <small>
                        {knowledge.description.length.toLocaleString()} / 20,000
                        characters
                      </small>
                    </label>
                    <label className="field wide website-field">
                      <span>
                        <Globe2 size={15} />
                        Existing website link<small>Optional</small>
                      </span>
                      <div className="url-input">
                        <span>↗</span>
                        <input
                          type="text"
                          inputMode="url"
                          value={knowledge.websiteUrl}
                          onChange={(e) => update("websiteUrl", e.target.value)}
                          placeholder="https://your-current-website.com"
                        />
                        <button
                          type="button"
                          aria-label="Read existing website"
                          disabled={!knowledge.websiteUrl || crawling || busy}
                          onClick={() => {
                            lastAttempt.current = normalizeUrl(
                              knowledge.websiteUrl,
                            );
                            setSkipWebsite(false);
                            void discover(knowledge.websiteUrl, true).catch(
                              () => {},
                            );
                          }}
                        >
                          {crawling ? (
                            <Loader2 size={16} className="spin" />
                          ) : (
                            <ArrowRight size={18} />
                          )}
                        </button>
                      </div>
                      <small>
                        We automatically read its public pages, business
                        details, imagery, and design cues.
                      </small>
                    </label>
                  </div>
                </fieldset>
                {(crawling || crawlError || source) && (
                  <div className="discovery-box" aria-live="polite">
                    {crawling && (
                      <p>
                        <Loader2 size={15} className="spin" />
                        {crawlStatus}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            pauseCrawl.current = true;
                            crawlController.current?.abort();
                          }}
                        >
                          Pause discovery
                        </button>
                      </p>
                    )}
                    {crawlError && (
                      <>
                        <p className="crawl-error">{crawlError}</p>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setSkipWebsite(true);
                            setCrawlError("");
                          }}
                        >
                          Continue with my description and entered details
                        </button>
                      </>
                    )}
                    {skipWebsite && (
                      <p>Website discovery skipped for this build.</p>
                    )}
                    {source && !crawling && (
                      <>
                        <div className="discovery-heading">
                          <span>
                            <Check size={15} />
                            {source.pages.length} pages read
                          </span>
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void discover(knowledge.websiteUrl, true).catch(
                                () => {},
                              )
                            }
                          >
                            <RefreshCw size={12} />
                            Read again
                          </button>
                        </div>
                        {(source.crawl?.canContinue ||
                          source.crawl?.canExtend ||
                          (!source.crawl && !source.complete)) && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void discover(
                                knowledge.websiteUrl,
                                false,
                                !!source.crawl?.canExtend &&
                                  !source.crawl.canContinue,
                              ).catch(() => {})
                            }
                          >
                            <Plus size={12} />
                            {source.crawl?.canContinue || !source.crawl
                              ? "Continue discovery"
                              : "Read more pages"}
                          </button>
                        )}
                        {source.crawl && (
                          <p className="help-text">
                            {source.crawl.pageLimit} page limit ·{" "}
                            {source.crawl.remaining} URLs remaining. Saved pages
                            are ready to use for generation.
                          </p>
                        )}
                        {source.pages.length > 40 && (
                          <p className="help-text">
                            All captured pages are saved. AI uses a bounded
                            packet of business evidence and deduplicated
                            contacts from the larger crawl.
                          </p>
                        )}
                        <div className="contact-chips">
                          {phones.slice(0, 3).map((phone) => (
                            <span key={phone}>{phone}</span>
                          ))}
                          {emails.slice(0, 3).map((email) => (
                            <span key={email}>{email}</span>
                          ))}
                        </div>
                        {source.warnings.map((w) => (
                          <p className="source-warning" key={w}>
                            {w}
                          </p>
                        ))}
                        <details>
                          <summary>
                            Review website knowledge <ChevronDown size={14} />
                          </summary>
                          <div className="source-pages">
                            {source.pages.map((page, i) => (
                              <details key={`${page.url}-${i}`}>
                                <summary>
                                  <span>
                                    {page.title || new URL(page.url).pathname}
                                  </span>
                                  <small>View details</small>
                                </summary>
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {page.url}
                                  <ExternalLink size={12} />
                                </a>
                                <p>{page.text}</p>
                                {page.structuredData.length > 0 && (
                                  <pre>
                                    {JSON.stringify(
                                      page.structuredData,
                                      null,
                                      2,
                                    )}
                                  </pre>
                                )}
                                <small>
                                  Colors:{" "}
                                  {page.design.colors.slice(0, 8).join(", ") ||
                                    "No colors detected"}
                                  <br />
                                  Fonts:{" "}
                                  {page.design.fonts.slice(0, 3).join(", ") ||
                                    "No fonts detected"}
                                  <br />
                                  {page.images.length} source images
                                </small>
                              </details>
                            ))}
                            {source.skipped.map((page, i) => (
                              <p key={`skipped-${i}`}>
                                {page.url}: {page.reason}
                              </p>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div className="section-number">02</div>
                  <div>
                    <h2>Business details</h2>
                    <p>The information your visitors will look for.</p>
                  </div>
                  <span className="optional-note">All optional</span>
                </div>
                <fieldset disabled={busy || !ready}>
                  <div className="form-grid">
                    {field("phone", "Business phone", "e.g. +1 212 555 0124", {
                      type: "tel",
                    })}
                    {field(
                      "email",
                      "Follow-up email",
                      "e.g. hello@yourbusiness.com",
                      { type: "email" },
                    )}
                    {field("location", "Location", "e.g. New York City, NY")}
                    {field(
                      "serviceArea",
                      "Service area",
                      "e.g. Manhattan, Jersey City, Hoboken",
                    )}
                    {field("hours", "Business hours", "e.g. Mon–Sat, 9am–6pm", {
                      wide: true,
                      rows: 2,
                    })}
                  </div>
                </fieldset>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div className="section-number">03</div>
                  <div>
                    <h2>Services offered</h2>
                    <p>Give each service a name and any useful details.</p>
                  </div>
                  <span className="optional-note">All optional</span>
                </div>
                <fieldset disabled={busy || !ready}>
                  {knowledge.services.length === 0 ? (
                    <div className="services-empty">
                      <span>No services added yet</span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setKnowledge((old) => ({
                            ...old,
                            services: [
                              ...old.services,
                              { name: "", description: "" },
                            ],
                          }))
                        }
                      >
                        <Plus size={15} />
                        Add a service
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="service-rows">
                        {knowledge.services.map((service, index) => (
                          <div className="service-row" key={index}>
                            <span className="service-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <label className="field">
                                <span>
                                  Service name<small>Optional</small>
                                </span>
                                <input
                                  value={service.name}
                                  placeholder="e.g. AC installation"
                                  onChange={(e) =>
                                    setKnowledge((old) => ({
                                      ...old,
                                      services: old.services.map((s, i) =>
                                        i === index
                                          ? { ...s, name: e.target.value }
                                          : s,
                                      ),
                                    }))
                                  }
                                />
                              </label>
                              <label className="field">
                                <span>
                                  Service details<small>Optional</small>
                                </span>
                                <textarea
                                  rows={2}
                                  value={service.description}
                                  placeholder="What's included, who it's for, or what makes it different"
                                  onChange={(e) =>
                                    setKnowledge((old) => ({
                                      ...old,
                                      services: old.services.map((s, i) =>
                                        i === index
                                          ? {
                                              ...s,
                                              description: e.target.value,
                                            }
                                          : s,
                                      ),
                                    }))
                                  }
                                />
                              </label>
                            </div>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove service ${index + 1}`}
                              onClick={() =>
                                setKnowledge((old) => ({
                                  ...old,
                                  services: old.services.filter(
                                    (_, i) => i !== index,
                                  ),
                                }))
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="text-button add-service"
                        disabled={knowledge.services.length >= 50}
                        onClick={() =>
                          setKnowledge((old) => ({
                            ...old,
                            services: [
                              ...old.services,
                              { name: "", description: "" },
                            ],
                          }))
                        }
                      >
                        <Plus size={15} />
                        Add another service
                      </button>
                    </>
                  )}
                </fieldset>
              </section>
              <section className="panel additional-panel">
                <fieldset disabled={busy || !ready}>
                  {field(
                    "additionalDetails",
                    "Anything else we should know?",
                    "Brand preferences, audience, tone, frequently asked questions, or other business knowledge…",
                    { wide: true, rows: 3 },
                  )}
                </fieldset>
              </section>
              <div className="form-footer">
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    download(
                      JSON.stringify({ knowledge, discovery: source }, null, 2),
                      "business-knowledge.json",
                      "application/json",
                    )
                  }
                >
                  <ArrowDownToLine size={14} />
                  Download knowledge
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || !ready}
                >
                  <Sparkles size={16} />
                  {busy
                    ? "Creating your websites…"
                    : plan &&
                        !changed &&
                        artifacts.length > 0 &&
                        artifacts.length < 3
                      ? "Continue generating designs"
                      : "Generate three websites"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
            <aside className="knowledge-aside">
              <div className="aside-card">
                <div className="aside-icon">
                  <Sparkles size={21} />
                </div>
                <h2>
                  A fresh point of view.
                  <br />
                  Three, actually.
                </h2>
                <p>
                  One business brief becomes three independently designed
                  websites. Choose the one that feels like you.
                </p>
                <div className="mini-compositions" aria-hidden="true">
                  <div>
                    <i />
                    <b />
                    <span />
                    <span />
                  </div>
                  <div>
                    <b />
                    <i />
                    <span />
                  </div>
                  <div>
                    <span />
                    <i />
                    <b />
                  </div>
                </div>
                <div className="aside-divider" />
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <b>Your knowledge</b>
                      <p>Your description and the details you choose to add.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <b>Your website, understood</b>
                      <p>
                        Public pages and details from your existing link, when
                        provided.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <b>Three original directions</b>
                      <p>
                        Preview each design, compare on mobile, and download
                        your favorite.
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
              <div className="privacy-note">
                <span className="privacy-dot" />
                Your draft stays on this device. Knowledge is sent to OpenRouter
                when you generate.
              </div>
            </aside>
          </form>
        </div>
        <section
          hidden={tab !== "designs"}
          id="designs-panel"
          role="tabpanel"
          aria-labelledby="designs-tab"
          className="designs-panel"
        >
          {changed && (
            <div className="notice">
              Your knowledge has changed. Generate again to create designs with
              the updated details.
            </div>
          )}
          {!plan && !artifacts.length ? (
            <div className="design-empty">
              <Layers3 size={45} strokeWidth={1} />
              <h2>Three directions, waiting to take shape.</h2>
              <p>
                Add a description to your business knowledge, then generate your
                designs.
              </p>
              <button
                className="primary-button"
                onClick={() => setTab("knowledge")}
              >
                Add your knowledge
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="design-cards">
                {[0, 1, 2].map((index) => {
                  const artifact = artifacts.find((a) => a.index === index);
                  const direction = plan?.directions[index];
                  return (
                    <div
                      key={index}
                      className={`design-card ${selected === index ? "selected" : ""}`}
                    >
                      <button
                        className="design-choice"
                        onClick={() => setSelected(index)}
                        aria-pressed={selected === index}
                      >
                        <span className="design-card-number">0{index + 1}</span>
                        <span>
                          <b>
                            {direction?.name ??
                              artifact?.name ??
                              `Version ${index + 1}`}
                          </b>
                          <small>
                            {artifact
                              ? "Ready to explore"
                              : busy && selected === index
                                ? "Designing…"
                                : variantErrors[index]
                                  ? "Needs another try"
                                  : "Not generated yet"}
                          </small>
                        </span>
                        {artifact ? (
                          <Check size={18} />
                        ) : (
                          <span className="palette-dots">
                            {direction?.palette.slice(0, 3).map((color, i) => (
                              <i
                                key={i}
                                style={{
                                  backgroundColor: /^#[\da-f]{3,8}$/i.test(
                                    color,
                                  )
                                    ? color
                                    : "#c2c8bf",
                                }}
                              />
                            ))}
                          </span>
                        )}
                      </button>
                      {variantErrors[index] && (
                        <div className="variant-error" role="alert">
                          <p>{variantErrors[index]}</p>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void generate(undefined, index)}
                          >
                            <RefreshCw size={13} />
                            Retry this version
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {plan?.media?.[selected]?.warnings.map((warning) => (
                <div className="notice" key={warning}>
                  {warning}
                </div>
              ))}
              <div className="preview-shell">
                <div className="preview-toolbar">
                  <div className="window-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="preview-title">
                    {current?.name ??
                      plan?.directions[selected]?.name ??
                      "Your design"}
                  </span>
                  <div className="device-picker">
                    <button
                      aria-label="Desktop preview"
                      aria-pressed={device === "desktop"}
                      className={device === "desktop" ? "active" : ""}
                      onClick={() => setDevice("desktop")}
                    >
                      <Monitor size={16} />
                    </button>
                    <button
                      aria-label="Mobile preview"
                      aria-pressed={device === "mobile"}
                      className={device === "mobile" ? "active" : ""}
                      onClick={() => setDevice("mobile")}
                    >
                      <Smartphone size={16} />
                    </button>
                  </div>
                  {current && (
                    <button
                      className="secondary-button"
                      onClick={() => downloadSite(current)}
                    >
                      <ArrowDownToLine size={14} />
                      {current.pages?.length
                        ? "Download site (.zip)"
                        : "Download HTML"}
                    </button>
                  )}
                  {shownPath && (
                    <a
                      className="secondary-button"
                      href={shownPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      Open website
                    </a>
                  )}
                </div>
                {shownPath && (
                  <div className="site-address">
                    <span>Website link</span>
                    <a href={shownPath} target="_blank" rel="noreferrer">
                      {shownPath}
                    </a>
                  </div>
                )}
                {current?.path && (
                  <div className="site-pages">
                    {!!current.pages?.length && (
                      <div
                        className="page-tabs"
                        role="tablist"
                        aria-label="Website pages"
                      >
                        {[
                          { slug: HOME_PAGE, title: "Home" },
                          ...current.pages,
                        ].map((page) => {
                          const active =
                            (currentPage?.slug ?? HOME_PAGE) === page.slug;
                          return (
                            <button
                              key={page.slug}
                              role="tab"
                              aria-selected={active}
                              className={active ? "active" : ""}
                              onClick={() =>
                                setSelectedPages((old) => ({
                                  ...old,
                                  [selected]: page.slug,
                                }))
                              }
                            >
                              {page.title}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="site-pages-actions">
                      {pendingRetry > 0 && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void buildSite(true)}
                        >
                          <RefreshCw size={14} />
                          Retry missing pages
                        </button>
                      )}
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => void buildSite()}
                        title="Create About, Menu/Services, Contact and other pages from your business knowledge and website, in this design"
                      >
                        <FileStack size={14} />
                        {current.pages?.length
                          ? "Rebuild pages"
                          : "Build full site"}
                      </button>
                    </div>
                  </div>
                )}
                <div className={`preview-stage ${device}`}>
                  {current?.path && (
                    <AssistantEmbed
                      key={current.id}
                      path={current.path}
                      revision={current.id}
                    />
                  )}
                  {current ? (
                    <iframe
                      title={`${current.name} website preview`}
                      srcDoc={shownHtml}
                      sandbox=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="preview-placeholder">
                      {busy ? (
                        <Loader2 size={28} className="spin" />
                      ) : (
                        <Sparkles size={28} />
                      )}
                      <h3>
                        {busy
                          ? "Giving your business a new perspective…"
                          : "This design is waiting to be generated."}
                      </h3>
                      <p>{plan?.directions[selected]?.concept}</p>
                      {!busy && (
                        <button
                          className="primary-button"
                          onClick={() => void generate(undefined, selected)}
                        >
                          Generate this design
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {current && (
                <form
                  className="panel change-panel"
                  onSubmit={(event) => void refine(event)}
                >
                  <div className="panel-title">
                    <h2>
                      Refine version {selected + 1}
                      {currentPage ? ` — ${currentPage.title} page` : ""}
                    </h2>
                    <span className="help-text">
                      {current.pages?.length
                        ? "Changes apply to the page shown above"
                        : "Changes apply to this version"}
                    </span>
                  </div>
                  <label className="field">
                    <span>Describe your changes</span>
                    <textarea
                      rows={3}
                      maxLength={6000}
                      disabled={busy}
                      value={changePrompts[selected] ?? ""}
                      onChange={(event) =>
                        setChangePrompts((old) => ({
                          ...old,
                          [selected]: event.target.value,
                        }))
                      }
                      placeholder="e.g. Make the hero more striking, use warmer colors, and give the services section more space."
                    />
                  </label>
                  <div className="change-actions">
                    <p className="help-text">
                      AI uses this site's saved knowledge. To change business
                      facts, update Business knowledge and regenerate.
                    </p>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={
                        busy ||
                        !current.path ||
                        (changePrompts[selected] ?? "").trim().length < 3
                      }
                    >
                      <Sparkles size={15} />
                      Apply changes
                    </button>
                  </div>
                  {!!(currentPage ?? current).edits?.length && (
                    <details className="change-history">
                      <summary>
                        Accepted changes (
                        {(currentPage ?? current).edits!.length})
                      </summary>
                      <ol>
                        {(currentPage ?? current).edits!.map((edit, i) => (
                          <li key={`${edit.createdAt}-${i}`}>
                            <p>{edit.prompt}</p>
                            <time dateTime={edit.createdAt}>
                              {new Date(edit.createdAt).toLocaleString()}
                            </time>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </form>
              )}
              {current?.path && (
                <BookingPanel
                  key={current.path ?? "none"}
                  business={decodeURIComponent(
                    (current.path ?? "").split("/")[2] ?? "",
                  )}
                  defaultEmail={knowledge.email}
                  headers={headers}
                />
              )}
              {current && (
                <div className="design-detail">
                  <div>
                    <h3>The thinking behind this design</h3>
                    <p>{current.rationale}</p>
                    {current.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                  <div className="model-credit">
                    <span>Generated with</span>
                    <b>{current.model}</b>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void generate(undefined, selected)}
                    >
                      <RefreshCw size={13} />
                      Regenerate this version
                    </button>
                  </div>
                </div>
              )}
              <div className="designs-footer">
                <p>
                  {!busy && status
                    ? status
                    : "Your websites are static HTML documents. Contact links work when provided; bookings and other backend services require a separate integration."}
                </p>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void generate()}
                >
                  <Sparkles size={15} />
                  {artifacts.length === 3
                    ? "Create three new designs"
                    : "Generate missing designs"}
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          )}
        </section>
        <footer className="workspace-footer">
          <span>EVERONN WEBSITE STUDIO</span>
          <span>Built around your business.</span>
        </footer>
      </main>
    </div>
  );
}
