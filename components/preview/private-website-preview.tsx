"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Check, Clock3, LockKeyhole, Mail, MapPin, Menu, Phone, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import type { BusinessProfile, WebsiteMediaAsset, WebsiteProject, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";
import { generateDeterministicWebsiteSpec } from "@/features/website-studio/generator";
import { WebsiteAssistant } from "./website-assistant";

export type WebsiteTheme = "editorial" | "momentum" | "aura";

function preparedSpec(project: WebsiteProject, profile: BusinessProfile) {
  const supplied = project.spec as WebsiteSpec & Partial<WebsiteSpec>;
  if (project.generation?.provider === "gemini") return supplied as WebsiteSpec;
  const fallback = generateDeterministicWebsiteSpec(profile);
  const services = fallback.services.map((service) => ({
    ...service,
    ...(supplied.services?.find((item) => item.id === service.id || item.name === service.name) || {}),
  }));
  return {
    ...fallback,
    ...supplied,
    seo: { ...fallback.seo, ...(supplied.seo || {}) },
    mediaPlan: { ...fallback.mediaPlan, ...(supplied.mediaPlan || {}) },
    media: { ...fallback.media, ...(supplied.media || {}), story: supplied.media?.story || supplied.media?.gallery?.[0] || supplied.media?.hero || null },
    hero: { ...fallback.hero, ...(supplied.hero || {}) },
    servicesIntro: { ...fallback.servicesIntro, ...(supplied.servicesIntro || {}) },
    services,
    benefits: supplied.benefits?.length ? supplied.benefits : fallback.benefits,
    process: supplied.process?.length ? supplied.process : fallback.process,
    about: { ...fallback.about, ...(supplied.about || {}) },
    contact: { ...fallback.contact, ...(supplied.contact || {}) },
  } satisfies WebsiteSpec;
}

function contactHref(profile: BusinessProfile) {
  if (profile.phone) return `tel:${profile.phone.replace(/[^+\d]/g, "")}`;
  if (profile.email) return `mailto:${profile.email}`;
  return "#contact";
}

function pageHref(project: WebsiteProject, theme: WebsiteTheme, previewToken: string | undefined, path = "") {
  const base = previewToken ? `/preview/${encodeURIComponent(previewToken)}` : `/sites/${encodeURIComponent(project.publicSlug)}`;
  const target = path ? `${base}/${path.replace(/^\/+/, "")}` : base;
  return previewToken ? `${target}?theme=${theme}` : target;
}

function PhotoCredit({ asset }: { asset: WebsiteMediaAsset }) {
  const label = `Photo by ${asset.photographer}`;
  return asset.sourceUrl
    ? <a className="client-photo-credit" href={asset.sourceUrl} target="_blank" rel="noreferrer">{label} · Pexels</a>
    : <span className="client-photo-credit">{label} · Pexels</span>;
}

function WebsitePhoto({ asset, alt, className, priority = false }: { asset?: WebsiteMediaAsset | null; alt: string; className: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!asset || failed) return <div className={`${className} client-photo-fallback`} aria-label={alt}><span>{alt.slice(0, 1)}</span><small>Prepared for {alt}</small></div>;
  return <figure className={className}>
    <Image src={asset.url} alt={asset.alt || alt} fill priority={priority} sizes="(max-width: 570px) 94vw, (max-width: 900px) 88vw, 50vw" onError={() => setFailed(true)} />
    <PhotoCredit asset={asset} />
  </figure>;
}

function HeroVisual({ asset, tagline, profile }: { asset: WebsiteMediaAsset | null; tagline: string; profile: BusinessProfile }) {
  return <div className="client-hero-visual"><WebsitePhoto asset={asset} alt={profile.businessType} className="client-hero-media" priority /><div className="client-hero-media-card"><small>Customer-ready</small><strong>{tagline}</strong></div></div>;
}

function ContactDetails({ profile }: { profile: BusinessProfile }) {
  const items = [
    profile.serviceArea && { icon: MapPin, label: "Service area", value: profile.serviceArea },
    profile.hours && { icon: Clock3, label: "Hours", value: profile.hours },
    profile.phone && { icon: Phone, label: "Phone", value: profile.phone, href: `tel:${profile.phone.replace(/[^+\d]/g, "")}` },
    profile.email && { icon: Mail, label: "Email", value: profile.email, href: `mailto:${profile.email}` },
  ].filter(Boolean) as Array<{ icon: typeof Phone; label: string; value: string; href?: string }>;
  return <div className="client-contact-details">{items.map((item) => {
    const Icon = item.icon;
    const contents = <><Icon /><span><small>{item.label}</small><strong>{item.value}</strong></span></>;
    return item.href ? <a href={item.href} key={item.label}>{contents}</a> : <div key={item.label}>{contents}</div>;
  })}</div>;
}

function SectionHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="client-section-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function ServiceCard({ service, index, site, href }: { service: WebsiteServiceSpec; index: number; site: WebsiteSpec; href: string }) {
  return <article><WebsitePhoto asset={site.media.services[service.id]} alt={service.name} className="client-service-media" /><div className="client-service-copy"><b>{String(index + 1).padStart(2, "0")}</b><small>{service.idealFor}</small><h3><Link href={href}>{service.name}</Link></h3><p>{service.summary}</p><ul>{service.details.slice(0, 3).map((detail) => <li key={detail}>{detail}</li>)}</ul><Link href={href}>{service.ctaLabel} <ArrowRight /></Link></div></article>;
}

function ServiceGrid({ project, site, theme, previewToken, services = site.services }: { project: WebsiteProject; site: WebsiteSpec; theme: WebsiteTheme; previewToken?: string; services?: WebsiteServiceSpec[] }) {
  return <div className="client-service-grid">{services.map((service) => {
    const index = site.services.indexOf(service);
    return <ServiceCard service={service} index={index} site={site} href={pageHref(project, theme, previewToken, `services/${service.slug}`)} key={service.id} />;
  })}</div>;
}

function ProcessSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-process"><SectionHeading eyebrow="How it works" title="A useful path from question to confirmation." copy="Every channel follows the same approved business process." /><div className="client-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>;
}

function BenefitsSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-benefits"><div className="client-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>;
}

function GallerySection({ site, profile }: { site: WebsiteSpec; profile: BusinessProfile }) {
  if (!site.media.gallery.length) return null;
  return <section className="client-gallery"><SectionHeading eyebrow="Inside the work" title="A closer look at the customer experience." copy={`Relevant visual direction selected for ${profile.businessName}.`} /><div className="client-gallery-grid">{site.media.gallery.map((asset, index) => <WebsitePhoto asset={asset} alt={`${profile.businessName} ${index + 1}`} className="client-gallery-photo" priority={index === 0} key={asset.id} />)}</div></section>;
}

function FaqSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-faq"><SectionHeading eyebrow="Questions, answered" title="Useful details before you reach out." copy="Answers come from the same approved information used by AI chat and voice." /><div>{site.faq.map((item, index) => <details key={item.question} open={index === 0}><summary>{item.question}<i>+</i></summary><p>{item.answer}</p></details>)}</div></section>;
}

function ContactSection({ site, profile }: { site: WebsiteSpec; profile: BusinessProfile }) {
  return <section className="client-contact" id="contact"><ShieldCheck /><span>{site.contact.eyebrow}</span><h2>{site.contact.title}</h2><p>{site.contact.copy}</p><div><a href={contactHref(profile)}>{profile.phone ? `Call ${profile.phone}` : site.contact.ctaLabel}</a>{profile.email && <a href={`mailto:${profile.email}`}>Send an email</a>}</div></section>;
}

function Header({ project, profile, theme, previewToken, active, menuOpen, setMenuOpen }: { project: WebsiteProject; profile: BusinessProfile; theme: WebsiteTheme; previewToken?: string; active: string; menuOpen: boolean; setMenuOpen: (open: boolean) => void }) {
  const links = [["home", "Home", ""], ["services", "Services", "services"], ["about", "About", "about"], ["contact", "Contact", "contact"]];
  return <header className="client-header"><Link href={pageHref(project, theme, previewToken)} className="client-logo">{profile.businessName}<small>{project.spec.brand.tagline}</small></Link><nav className={menuOpen ? "open" : ""}>{links.map(([key, label, path]) => <Link className={active === key ? "active" : ""} href={pageHref(project, theme, previewToken, path)} onClick={() => setMenuOpen(false)} key={key}>{label}</Link>)}</nav><a className="client-call" href={contactHref(profile)}><Phone /> {profile.phone || "Contact us"}</a><button className="client-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>{menuOpen ? <X /> : <Menu />}</button></header>;
}

function PageHero({ eyebrow, title, copy, asset, profile }: { eyebrow: string; title: string; copy: string; asset?: WebsiteMediaAsset | null; profile: BusinessProfile }) {
  return <section className="client-page-hero"><div><span>{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div><WebsitePhoto asset={asset} alt={profile.businessType} className="client-page-photo" priority /></section>;
}

function HomePage({ project, profile, site, theme, previewToken }: GeneratedPageProps) {
  return <main id="main"><section className="client-hero"><div className="client-hero-copy"><span>{site.hero.eyebrow}</span><h1>{site.hero.headline}</h1><p>{site.hero.subheadline}</p><div><a href={contactHref(profile)}>{site.hero.primaryCta} <ArrowRight /></a><Link href={pageHref(project, theme, previewToken, "services")}>{site.hero.secondaryCta}</Link></div></div><HeroVisual asset={site.media.hero} tagline={site.brand.tagline} profile={profile} /></section><section className="client-proof"><span><Check /> Approved business information</span><span><Check /> AI chat and voice ready</span><span><Check /> Complete mobile experience</span></section><BenefitsSection site={site} /><section className="client-section client-services" id="services"><SectionHeading {...site.servicesIntro} /><ServiceGrid project={project} site={site} theme={theme} previewToken={previewToken} services={site.services.slice(0, 6)} /><Link className="client-all-services" href={pageHref(project, theme, previewToken, "services")}>Explore all services <ArrowRight /></Link></section><GallerySection site={site} profile={profile} /><section className="client-section client-about"><div><span>{site.about.eyebrow}</span><h2>{site.about.title}</h2><Link className="client-text-link" href={pageHref(project, theme, previewToken, "about")}>About {profile.businessName} <ArrowRight /></Link></div><div><p>{site.about.body}</p><ContactDetails profile={profile} /></div></section><ProcessSection site={site} /><FaqSection site={site} /><ContactSection site={site} profile={profile} /></main>;
}

type GeneratedPageProps = { project: WebsiteProject; profile: BusinessProfile; site: WebsiteSpec; theme: WebsiteTheme; previewToken?: string };

function ServicesPage(props: GeneratedPageProps) {
  const { project, profile, site, theme, previewToken } = props;
  return <main id="main"><PageHero eyebrow={site.servicesIntro.eyebrow} title={site.servicesIntro.title} copy={site.servicesIntro.copy} asset={site.media.hero} profile={profile} /><section className="client-section client-services client-services-page"><ServiceGrid project={project} site={site} theme={theme} previewToken={previewToken} /></section><ProcessSection site={site} /><ContactSection site={site} profile={profile} /></main>;
}

function ServicePage({ project, profile, site, theme, previewToken, service }: GeneratedPageProps & { service: WebsiteServiceSpec }) {
  const related = site.services.filter((item) => item.id !== service.id).slice(0, 3);
  return <main id="main"><section className="client-service-hero"><div><Link href={pageHref(project, theme, previewToken, "services")}><ArrowLeft /> All services</Link><span>{profile.businessType}</span><h1>{service.pageHeadline}</h1><p>{service.pageIntro}</p><a className="client-primary-action" href={contactHref(profile)}>{service.ctaLabel}<ArrowRight /></a></div><WebsitePhoto asset={site.media.services[service.id] || site.media.hero} alt={service.name} className="client-page-photo" priority /></section><section className="client-service-band"><span>Designed for</span><strong>{service.idealFor}</strong></section><section className="client-section client-service-detail"><aside><span>At a glance</span><h2>{service.name}</h2><ul>{service.details.map((detail) => <li key={detail}><Check />{detail}</li>)}</ul></aside><div>{service.pageSections.map((section, index) => <article key={section.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{section.title}</h2><p>{section.copy}</p></div></article>)}</div></section>{related.length > 0 && <section className="client-section client-services client-related"><SectionHeading eyebrow="Explore more" title="Related ways the team can help." copy="Continue through the complete service catalogue." /><ServiceGrid project={project} site={site} theme={theme} previewToken={previewToken} services={related} /></section>}<ContactSection site={site} profile={profile} /></main>;
}

function AboutPage({ profile, site }: GeneratedPageProps) {
  return <main id="main"><PageHero eyebrow={site.about.eyebrow} title={site.about.title} copy={site.about.body} asset={site.media.story || site.media.hero} profile={profile} /><BenefitsSection site={site} /><GallerySection site={site} profile={profile} /><ProcessSection site={site} /><ContactSection site={site} profile={profile} /></main>;
}

function ContactPage({ profile, site }: GeneratedPageProps) {
  return <main id="main"><section className="client-contact-page"><div><span>{site.contact.eyebrow}</span><h1>{site.contact.title}</h1><p>{site.contact.copy}</p><ContactDetails profile={profile} /><a className="client-primary-action" href={contactHref(profile)}>{site.contact.ctaLabel}<ArrowRight /></a></div><WebsitePhoto asset={site.media.hero} alt={profile.businessType} className="client-page-photo" priority /></section><FaqSection site={site} /></main>;
}

function Footer({ project, profile, site, theme, previewToken }: GeneratedPageProps) {
  return <footer className="client-footer"><div><Link href={pageHref(project, theme, previewToken)}><strong>{profile.businessName}</strong></Link><p>{site.brand.positioning}</p></div><div><strong>Explore</strong><Link href={pageHref(project, theme, previewToken)}>Home</Link><Link href={pageHref(project, theme, previewToken, "services")}>Services</Link><Link href={pageHref(project, theme, previewToken, "about")}>About</Link><Link href={pageHref(project, theme, previewToken, "contact")}>Contact</Link></div><div><strong>Services</strong>{site.services.slice(0, 4).map((service) => <Link href={pageHref(project, theme, previewToken, `services/${service.slug}`)} key={service.id}>{service.name}</Link>)}</div><div><strong>Connect</strong>{profile.phone && <a href={contactHref(profile)}>{profile.phone}</a>}{profile.email && <a href={`mailto:${profile.email}`}>{profile.email}</a>}<span>{profile.serviceArea || profile.location}</span></div><small>© {new Date().getFullYear()} {profile.businessName} · Powered by EverOnn</small></footer>;
}

export function websiteRouteExists(project: WebsiteProject, route: string[] = []) {
  if (!route.length || (route.length === 1 && ["services", "about", "contact"].includes(route[0]))) return true;
  return route.length === 2 && route[0] === "services" && project.spec.services.some((service) => service.slug === route[1]);
}

export function GeneratedWebsite({ project, profile, theme, previewToken, route = [] }: { project: WebsiteProject; profile: BusinessProfile; theme: WebsiteTheme; previewToken?: string; route?: string[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const site = preparedSpec(project, profile);
  const active = route[0] || "home";
  const service = route[0] === "services" && route[1] ? site.services.find((item) => item.slug === route[1]) : undefined;
  const props = { project, profile, site, theme, previewToken };
  const content = service ? <ServicePage {...props} service={service} /> : active === "services" ? <ServicesPage {...props} /> : active === "about" ? <AboutPage {...props} /> : active === "contact" ? <ContactPage {...props} /> : <HomePage {...props} />;
  return <div className={`client-preview theme-${theme}`} style={{ "--client-primary": site.visualDirection.primaryColor, "--client-accent": site.visualDirection.accentColor } as React.CSSProperties}>{previewToken && <div className="preview-notice"><LockKeyhole /><span>Private EverOnn concept · Not an official public website</span><strong>{theme} concept</strong></div>}<Header project={project} profile={profile} theme={theme} previewToken={previewToken} active={active} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />{content}<Footer {...props} /><WebsiteAssistant profile={profile} previewToken={previewToken} publicSlug={previewToken ? undefined : project.publicSlug} /></div>;
}

export function PrivateWebsitePreview({ token, route = [] }: { token: string; route?: string[] }) {
  const query = useSearchParams();
  const { workspace, hydrated } = useEverOnnWorkspace();
  const requestedTheme = query.get("theme");
  const theme: WebsiteTheme = requestedTheme === "momentum" || requestedTheme === "aura" ? requestedTheme : "editorial";
  const project = workspace.websiteProject;
  const allowed = token === "demo" || project?.privateToken === token;
  if (!hydrated) return <main className="preview-denied"><LockKeyhole /><h1>Loading private preview…</h1><p>EverOnn is reading the approved workspace JSON.</p></main>;
  if (!allowed || !project || !websiteRouteExists(project, route)) return <main className="preview-denied"><LockKeyhole /><h1>This private preview link is not valid.</h1><p>Ask the business owner or EverOnn for a fresh capability link.</p></main>;
  return <GeneratedWebsite project={project} profile={workspace.profile} theme={theme} previewToken={token} route={route} />;
}
