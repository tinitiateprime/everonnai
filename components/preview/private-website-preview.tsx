"use client";

import { ArrowRight, Check, LockKeyhole, Menu, Phone, ShieldCheck, X } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useEverOnnWorkspace } from "@/features/everonn/workspace-provider";
import type { WebsiteMediaAsset } from "@/features/everonn/types";
import { generateDeterministicWebsiteSpec } from "@/features/website-studio/generator";
import { WebsiteAssistant } from "./website-assistant";

type Theme = "editorial" | "momentum" | "aura";

function PhotoCredit({ asset }: { asset: WebsiteMediaAsset }) {
  const label = `Photo by ${asset.photographer}`;
  return asset.sourceUrl
    ? <a className="client-photo-credit" href={asset.sourceUrl} target="_blank" rel="noreferrer">{label} · Pexels</a>
    : <span className="client-photo-credit">{label} · Pexels</span>;
}

function HeroVisual({ asset, tagline }: { asset: WebsiteMediaAsset | null; tagline: string }) {
  const [failed, setFailed] = useState(false);
  if (!asset || failed) {
    return <div className="client-hero-art"><i /><i /><div><small>Customer-ready</small><strong>{tagline}</strong></div></div>;
  }
  return <figure className="client-hero-media">
    <Image src={asset.url} alt={asset.alt} fill priority sizes="(max-width: 850px) 92vw, 44vw" onError={() => setFailed(true)} />
    <div className="client-hero-media-card"><small>Customer-ready</small><strong>{tagline}</strong></div>
    <PhotoCredit asset={asset} />
  </figure>;
}

function ServicePhoto({ asset }: { asset?: WebsiteMediaAsset }) {
  const [failed, setFailed] = useState(false);
  if (!asset || failed) return null;
  return <figure className="client-service-media">
    <Image src={asset.url} alt={asset.alt} fill sizes="(max-width: 570px) 92vw, (max-width: 850px) 45vw, 380px" onError={() => setFailed(true)} />
    <PhotoCredit asset={asset} />
  </figure>;
}

function GalleryPhoto({ asset, priority }: { asset: WebsiteMediaAsset; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <figure className="client-gallery-photo">
    <Image src={asset.url} alt={asset.alt} fill priority={priority} sizes="(max-width: 570px) 92vw, (max-width: 850px) 46vw, 390px" onError={() => setFailed(true)} />
    <PhotoCredit asset={asset} />
  </figure>;
}

export function PrivateWebsitePreview({ token }: { token: string }) {
  const query = useSearchParams();
  const { workspace, hydrated } = useEverOnnWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const requestedTheme = query.get("theme");
  const theme: Theme = requestedTheme === "momentum" || requestedTheme === "aura" ? requestedTheme : "editorial";
  const project = workspace.websiteProject;
  const allowed = token === "demo" || project?.privateToken === token;
  const spec = project?.spec || generateDeterministicWebsiteSpec(workspace.profile);
  const profile = workspace.profile;

  if (!hydrated) {
    return <main className="preview-denied"><LockKeyhole /><h1>Loading private preview…</h1><p>EverOnn is reading the approved workspace JSON.</p></main>;
  }

  if (!allowed) {
    return <main className="preview-denied"><LockKeyhole /><h1>This private preview link is not valid.</h1><p>Ask the business owner or EverOnn for a fresh capability link.</p></main>;
  }

  return (
    <div className={`client-preview theme-${theme}`} style={{ "--client-primary": spec.visualDirection.primaryColor, "--client-accent": spec.visualDirection.accentColor } as React.CSSProperties}>
      <div className="preview-notice"><LockKeyhole /><span>Private EverOnn concept · Not an official public website</span><strong>{theme} concept</strong></div>
      <header className="client-header">
        <a href="#top" className="client-logo">{profile.businessName}</a>
        <nav className={menuOpen ? "open" : ""}><a href="#services" onClick={() => setMenuOpen(false)}>Services</a><a href="#about" onClick={() => setMenuOpen(false)}>About</a><a href="#faq" onClick={() => setMenuOpen(false)}>Questions</a><a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a></nav>
        <a className="client-call" href={`tel:${profile.phone}`}><Phone /> {profile.phone || "Contact us"}</a>
        <button className="client-menu" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle menu">{menuOpen ? <X /> : <Menu />}</button>
      </header>
      <main id="top">
        <section className="client-hero">
          <div className="client-hero-copy"><span>{spec.hero.eyebrow}</span><h1>{spec.hero.headline}</h1><p>{spec.hero.subheadline}</p><div><a href="#contact">{spec.hero.primaryCta} <ArrowRight /></a><a href="#services">Explore services</a></div></div>
          <HeroVisual asset={spec.media.hero} tagline={spec.brand.tagline} />
        </section>
        <section className="client-proof"><span><Check /> Approved business information</span><span><Check /> Clear customer next steps</span><span><Check /> Mobile-ready experience</span></section>
        <section className="client-section client-services" id="services"><div className="client-section-heading"><span>What we do</span><h2>Services designed around what customers need.</h2><p>{spec.brand.positioning}</p></div><div className="client-service-grid">{spec.services.map((service, index) => <article key={service.id}><ServicePhoto asset={spec.media.services[service.id]} /><div className="client-service-copy"><b>{String(index + 1).padStart(2, "0")}</b><h3>{service.name}</h3><p>{service.summary}</p><ul>{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul><a href="#contact">Ask about this service <ArrowRight /></a></div></article>)}</div></section>
        {spec.media.gallery.length > 0 && <section className="client-gallery"><div className="client-section-heading"><span>Inside the work</span><h2>A closer look at the customer experience.</h2><p>Relevant visual direction selected for {profile.businessName}.</p></div><div className="client-gallery-grid">{spec.media.gallery.map((asset, index) => <GalleryPhoto asset={asset} priority={index === 0} key={asset.id} />)}</div></section>}
        <section className="client-section client-about" id="about"><div><span>About the business</span><h2>{spec.about.title}</h2></div><div><p>{spec.about.body}</p><dl><div><dt>Service area</dt><dd>{profile.serviceArea || profile.location}</dd></div><div><dt>Hours</dt><dd>{profile.hours}</dd></div></dl></div></section>
        <section className="client-section client-faq" id="faq"><div className="client-section-heading"><span>Questions, answered</span><h2>Useful details before you reach out.</h2></div><div>{spec.faq.map((item) => <details key={item.question}><summary>{item.question}<i>+</i></summary><p>{item.answer}</p></details>)}</div></section>
        <section className="client-contact" id="contact"><ShieldCheck /><h2>{spec.contact.title}</h2><p>{spec.contact.copy}</p><div><a href={`tel:${profile.phone}`}>{profile.phone ? `Call ${profile.phone}` : spec.contact.ctaLabel}</a><a href={`mailto:${profile.email}`}>Send an email</a></div></section>
      </main>
      <footer className="client-footer"><strong>{profile.businessName}</strong><span>Private concept prepared by EverOnn.Ai</span></footer>
      <WebsiteAssistant profile={profile} />
    </div>
  );
}
