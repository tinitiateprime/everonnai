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
  type Artifact,
  type DesignPlan,
  type Discovery,
  type Knowledge,
} from "@/lib/types";
import { readDraft, saveDraft } from "@/lib/browser-store";

type ModelOption = { id: string; name: string; context: number };
type DiscoveryEvent = { type: string; message?: string; discovery?: Discovery };
const normalizeUrl = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).href;
  } catch {
    return url;
  }
};
const download = (content: string, name: string, type: string) => {
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
  const buildController = useRef<AbortController | null>(null);
  const crawlController = useRef<AbortController | null>(null);
  const crawlPromise = useRef<{
    url: string;
    promise: Promise<Discovery>;
  } | null>(null);
  const lastAttempt = useRef("");
  const latestKnowledge = useRef(knowledge);
  latestKnowledge.current = knowledge;

  useEffect(() => {
    let mounted = true;
    readDraft()
      .then((draft) => {
        if (!mounted) return;
        if (draft?.version === 1) {
          const parsed = knowledgeSchema.safeParse(draft.knowledge);
          if (parsed.success || !draft.knowledge.description) {
            setKnowledge({ ...emptyKnowledge, ...draft.knowledge });
            setDiscovery(draft.discovery);
            setArtifacts(draft.artifacts ?? []);
            setPlan(draft.plan);
            setGeneratedFrom(draft.generatedFrom ?? "");
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
            "Could not load free models. Refresh the page to try again.",
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
      })
        .then(() => setSaving("Saved on this device"))
        .catch(() =>
          setSaving("Could not save on this device — download your knowledge"),
        );
    }, 450);
    return () => clearTimeout(timer);
  }, [ready, knowledge, discovery, artifacts, plan, generatedFrom]);

  const discover = useCallback(
    async (url: string, force = false): Promise<Discovery> => {
      if (!force && crawlPromise.current?.url === normalizeUrl(url))
        return crawlPromise.current.promise;
      crawlController.current?.abort();
      const controller = new AbortController();
      crawlController.current = controller;
      setCrawling(true);
      setCrawlError("");
      setCrawlStatus("Finding website pages…");
      const promise = (async () => {
        try {
          const response = await fetch("/api/discover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            signal: controller.signal,
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
            result: Discovery | undefined;
          const handle = (line: string) => {
            if (!line.trim()) return;
            const event: DiscoveryEvent = JSON.parse(line);
            if (event.type === "progress") setCrawlStatus(event.message ?? "");
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "result") result = event.discovery;
          };
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) handle(line);
          }
          if (buffer) handle(buffer);
          if (!result)
            throw new Error(
              "Discovery was interrupted. Try reading the website again.",
            );
          if (controller.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          if (
            normalizeUrl(latestKnowledge.current.websiteUrl) ===
            normalizeUrl(url)
          ) {
            setDiscovery(result);
            setCrawlStatus(`${result.pages.length} pages read`);
          }
          return result;
        } catch (error) {
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
      throw new Error(data.error ?? "Request failed.");
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
        setStatus("Reading your existing website…");
        source =
          discovery &&
          normalizeUrl(discovery.inputUrl) === normalizeUrl(snapshot.websiteUrl)
            ? discovery
            : await discover(snapshot.websiteUrl);
      }
      controller.signal.throwIfAborted();
      const fingerprint = JSON.stringify({
        knowledge: snapshot,
        source: source?.crawledAt ?? null,
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
          { knowledge: snapshot, discovery: source },
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
      for (const index of indexes) {
        setSelected(index);
        setStatus(
          `Designing ${index + 1} of 3 — ${currentPlan.directions[index].name}…`,
        );
        try {
          const response = await post<{ artifact: Artifact }>(
            "/api/generate",
            {
              knowledge: snapshot,
              discovery: source,
              direction: currentPlan.directions[index],
              index,
              previous: accepted.filter((a) => a.index !== index).slice(0, 2),
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
      }
      setStatus(
        accepted.length === 3
          ? "All three designs are ready."
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
    options: { wide?: boolean; type?: string; rows?: number } = {},
  ) => (
    <label className={`field ${options.wide ? "wide" : ""}`}>
      <span>
        {label}
        <small>Optional</small>
      </span>
      {options.rows ? (
        <textarea
          rows={options.rows}
          value={String(knowledge[key])}
          placeholder={placeholder}
          onChange={(e) => update(key, e.target.value)}
        />
      ) : (
        <input
          type={options.type ?? "text"}
          value={String(knowledge[key])}
          placeholder={placeholder}
          onChange={(e) => update(key, e.target.value)}
        />
      )}
    </label>
  );
  const current = artifacts.find((a) => a.index === selected);
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
        source: skipWebsite ? null : (source?.crawledAt ?? null),
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
                      <option value="">Automatic · free coding models</option>
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
              Only currently available models with zero input and output pricing
              are used. Free providers may have daily limits.{" "}
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
                      Start with a description. Add as much detail as you like.
                    </p>
                  </div>
                  <span className="required-note">One required field</span>
                </div>
                <fieldset disabled={busy || !ready}>
                  <div className="form-grid">
                    {field(
                      "businessName",
                      "Business name",
                      "e.g. Northline Heating & Air",
                    )}
                    {field(
                      "businessType",
                      "Business type",
                      "e.g. Residential & commercial HVAC",
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
                      onClick={() =>
                        download(
                          current.html,
                          `${current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "website"}.html`,
                          "text/html",
                        )
                      }
                    >
                      <ArrowDownToLine size={14} />
                      Download HTML
                    </button>
                  )}
                </div>
                <div className={`preview-stage ${device}`}>
                  {current ? (
                    <iframe
                      title={`${current.name} website preview`}
                      srcDoc={current.html}
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
