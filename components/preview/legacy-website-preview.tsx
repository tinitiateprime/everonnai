"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, Check, Clock3, LockKeyhole, Mail, MapPin, Menu, Phone, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { BusinessProfile, WebsiteMediaAsset, WebsiteProject, WebsiteServiceSpec, WebsiteSpec } from "@/features/everonn/types";
import { readableInk } from "@/features/website-studio/brand";
import type { WebsiteDesign } from "@/features/agent-runtime/types";
import "./legacy-preview.css";
import { WebsiteAssistant } from "./website-assistant";

export type WebsiteTheme = "editorial" | "momentum" | "aura";

// Read-only compatibility for already saved sites; never used by generation.
const DEFAULT_WEBSITE_DESIGN: WebsiteDesign = {
  rationale: "Previously saved website", typography: "modern", density: "airy",
  sectionOrder: ["services", "benefits", "about", "process", "gallery", "faq", "contact"], serviceOrder: [],
  concepts: { editorial: { hero: "split", services: "editorial" }, momentum: { hero: "immersive", services: "featured" }, aura: { hero: "centered", services: "cards" } },
  sectionHeadings: { process: { eyebrow: "Your next step", title: "From the first question to the right service.", copy: "Tell the team what you need." }, gallery: { eyebrow: "A closer look", title: "Comfort starts with the details.", copy: "Illustrative service photography." }, faq: { eyebrow: "Before you call", title: "A few things you may want to know.", copy: "Helpful answers about requesting service." } },
};
function preparedSpec(project: WebsiteProject) { const design = project.spec.design as WebsiteDesign | undefined; return { ...project.spec, design: design?.concepts ? design : DEFAULT_WEBSITE_DESIGN }; }

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
  if (!asset || failed) return <div className={`${className} client-photo-fallback`} aria-hidden="true" />;
  return <figure className={className}>
    <Image src={asset.url} alt={asset.alt || alt} fill priority={priority} sizes="(max-width: 570px) 94vw, (max-width: 900px) 88vw, 50vw" onError={() => setFailed(true)} />
    <PhotoCredit asset={asset} />
  </figure>;
}

function HeroVisual({ asset, tagline, profile }: { asset: WebsiteMediaAsset | null; tagline: string; profile: BusinessProfile }) {
  return <div className="client-hero-visual"><WebsitePhoto asset={asset} alt={profile.businessType} className="client-hero-media" priority /><div className="client-hero-media-card"><small>{profile.location || profile.serviceArea}</small><strong>{tagline}</strong></div></div>;
}

function HeroServices({ site, project, theme, previewToken }: GeneratedPageProps) {
  return <div className="client-hero-service-list"><span>{site.servicesIntro.eyebrow}</span><h2>{site.servicesIntro.title}</h2><div>{site.services.slice(0, 4).map((service, index) => <Link href={pageHref(project, theme, previewToken, `services/${service.slug}`)} key={service.id}><small>{String(index + 1).padStart(2, "0")}</small><strong>{service.name}</strong><ArrowRight /></Link>)}</div></div>;
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
  return <article>{(site.design as WebsiteDesign)?.imagery !== "none" && <WebsitePhoto asset={site.media.services[service.id]} alt={service.name} className="client-service-media" />}<div className="client-service-copy"><b>{String(index + 1).padStart(2, "0")}</b><small>{service.idealFor}</small><h3><Link href={href}>{service.name}</Link></h3><p>{service.summary}</p><ul>{service.details.slice(0, 3).map((detail) => <li key={detail}>{detail}</li>)}</ul><Link href={href}>{service.ctaLabel} <ArrowRight /></Link></div></article>;
}

function ServiceGrid({ project, site, theme, previewToken, services = site.services }: { project: WebsiteProject; site: WebsiteSpec; theme: WebsiteTheme; previewToken?: string; services?: WebsiteServiceSpec[] }) {
  const layout = (site.design as WebsiteDesign || DEFAULT_WEBSITE_DESIGN).concepts[theme].services;
  return <div className={`client-service-grid services-layout-${layout}`}>{services.map((service) => {
    const index = site.services.indexOf(service);
    return <ServiceCard service={service} index={index} site={site} href={pageHref(project, theme, previewToken, `services/${service.slug}`)} key={service.id} />;
  })}</div>;
}

function ProcessSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-process"><SectionHeading {...(site.design as WebsiteDesign || DEFAULT_WEBSITE_DESIGN).sectionHeadings.process} /><div className="client-process-grid">{site.process.map((item, index) => <article key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div></section>;
}

function BenefitsSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-benefits"><div className="client-benefit-grid">{site.benefits.map((item) => <article key={item.title}><BadgeCheck /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></section>;
}

function GallerySection({ site, profile }: { site: WebsiteSpec; profile: BusinessProfile }) {
  if (!site.media.gallery.length) return null;
  return <section className="client-gallery"><SectionHeading {...(site.design as WebsiteDesign || DEFAULT_WEBSITE_DESIGN).sectionHeadings.gallery} /><div className="client-gallery-grid">{site.media.gallery.map((asset, index) => <WebsitePhoto asset={asset} alt={`${profile.businessName} ${index + 1}`} className="client-gallery-photo" key={asset.id} />)}</div></section>;
}

function FaqSection({ site }: { site: WebsiteSpec }) {
  return <section className="client-section client-faq"><SectionHeading {...(site.design as WebsiteDesign || DEFAULT_WEBSITE_DESIGN).sectionHeadings.faq} /><div>{site.faq.map((item, index) => <details key={item.question} open={index === 0}><summary>{item.question}<i aria-hidden="true">+</i></summary><p>{item.answer}</p></details>)}</div></section>;
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
  const design = site.design as WebsiteDesign || DEFAULT_WEBSITE_DESIGN;
  const sections = {
    services: <section className="client-section client-services" id="services"><SectionHeading {...site.servicesIntro} /><ServiceGrid project={project} site={site} theme={theme} previewToken={previewToken} services={site.services.slice(0, 6)} /><Link className="client-all-services" href={pageHref(project, theme, previewToken, "services")}>Explore all services <ArrowRight /></Link></section>,
    benefits: <BenefitsSection site={site} />,
    gallery: <GallerySection site={site} profile={profile} />,
    about: <section className="client-section client-about"><div><span>{site.about.eyebrow}</span><h2>{site.about.title}</h2><Link className="client-text-link" href={pageHref(project, theme, previewToken, "about")}>About {profile.businessName} <ArrowRight /></Link></div><div><p>{site.about.body}</p><ContactDetails profile={profile} /></div></section>,
    process: <ProcessSection site={site} />, faq: <FaqSection site={site} />, contact: <ContactSection site={site} profile={profile} />,
  };
  return <main id="main" tabIndex={-1}>
    <section className={`client-hero hero-layout-${design.concepts[theme].hero}`}>
      <div className="client-hero-copy"><span>{site.hero.eyebrow}</span><h1>{site.hero.headline}</h1><p>{site.hero.subheadline}</p><div><a href={contactHref(profile)}>{site.hero.primaryCta} <ArrowRight /></a><Link href={pageHref(project, theme, previewToken, "services")}>{site.hero.secondaryCta}</Link></div></div>
      {design.imagery === "none" ? <HeroServices site={site} project={project} profile={profile} theme={theme} previewToken={previewToken} /> : <HeroVisual asset={site.media.hero} tagline={site.brand.tagline} profile={profile} />}
    </section>
    {(profile.serviceArea || profile.hours || profile.phone) && <section className="client-proof" aria-label="Business details">{profile.serviceArea && <span><MapPin />{profile.serviceArea}</span>}{profile.hours && <span><Clock3 />{profile.hours}</span>}{profile.phone && <a href={contactHref(profile)}><Phone />{profile.phone}</a>}</section>}
    {design.sectionOrder.map((id) => <div className={`client-section-slot slot-${id}`} key={id}>{sections[id]}</div>)}
  </main>;
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

export function LegacyWebsite({ project, profile, theme, previewToken, route = [] }: { project: WebsiteProject; profile: BusinessProfile; theme: WebsiteTheme; previewToken?: string; route?: string[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const prepared = preparedSpec(project);
  const design = prepared.design || DEFAULT_WEBSITE_DESIGN;
  const site = { ...prepared, services: [...prepared.services].sort((left, right) => {
    const leftPosition = design.serviceOrder.indexOf(left.id), rightPosition = design.serviceOrder.indexOf(right.id);
    return (leftPosition < 0 ? 1000 : leftPosition) - (rightPosition < 0 ? 1000 : rightPosition);
  }) };
  const active = route[0] || "home";
  const service = route[0] === "services" && route[1] ? site.services.find((item) => item.slug === route[1]) : undefined;
  const props = { project, profile, site, theme, previewToken };
  const content = service ? <ServicePage {...props} service={service} /> : active === "services" ? <ServicesPage {...props} /> : active === "about" ? <AboutPage {...props} /> : active === "contact" ? <ContactPage {...props} /> : <HomePage {...props} />;
  return <div className={`client-preview theme-${theme} type-${design.typography} density-${design.density} ${design.imagery === "none" ? "no-photography" : ""}`} style={{ "--client-primary": site.visualDirection.primaryColor, "--client-accent": site.visualDirection.accentColor, "--client-primary-ink": readableInk(site.visualDirection.primaryColor), "--client-accent-ink": readableInk(site.visualDirection.accentColor) } as React.CSSProperties}><a className="client-skip-link" href="#main">Skip to content</a>{previewToken && <div className="preview-notice"><LockKeyhole /><span>Private EverOnn concept · Not an official public website</span><strong>{theme} concept</strong></div>}<Header project={project} profile={profile} theme={theme} previewToken={previewToken} active={active} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />{content}<Footer {...props} /><WebsiteAssistant profile={profile} previewToken={previewToken} publicSlug={previewToken ? undefined : project.publicSlug} /></div>;
}
