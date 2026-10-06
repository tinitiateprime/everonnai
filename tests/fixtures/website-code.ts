import type { BusinessProfile, WebsiteCodeConcept, WebsiteSpec } from "@/features/everonn/types";
import type { WebsiteConcept } from "@/features/agent-runtime/types";
import { websitePaths } from "@/features/website-studio/code-validation";

// Local provider fixture only. Production has no HTML or CSS template fallback.
export function websiteCodeFixture(spec: WebsiteSpec, profile: BusinessProfile, concept: WebsiteConcept = "editorial"): WebsiteCodeConcept {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const title = escape(profile.businessName);
  const links = '<a href="/">Home</a><a href="/services">Services</a><a href="/about">About</a><a href="/contact">Contact</a>';
  const services = spec.services.map((service, index) => `<a class="service" data-service-id="${service.id}" href="/services/${service.slug}"><span>0${index + 1}</span><h2>${escape(service.name)}</h2><p>${escape(service.summary)}</p><b aria-hidden="true">↗</b></a>`).join("");
  const css = `
.site { box-sizing: border-box; min-height:100vh; margin:0; background:var(--brand-primary); color:#f8f5ee; font:16px/1.65 Arial,sans-serif; }
.site * { box-sizing:border-box; } .site a { color:inherit; text-decoration:none; } .site p { color:#cfcdc5; } .site h1,.site h2,.site p { margin:0; }
.top { display:flex; align-items:center; justify-content:space-between; gap:30px; max-width:1240px; margin:auto; padding:30px 40px; border-bottom:1px solid #ffffff24; }
.brand { font-weight:750; letter-spacing:-.04em; font-size:19px; } .top nav { display:flex; gap:30px; font-size:13px; } .mobile-menu { display:none; }
.canvas { max-width:1240px; margin:auto; padding:105px 40px 120px; } .eyebrow { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.18em; color:var(--brand-accent); margin-bottom:24px; }
.intro h1 { max-width:790px; font:500 clamp(42px,6.8vw,94px)/1.03 Georgia,serif; letter-spacing:-.045em; } .intro p { max-width:580px; margin-top:28px; }
.cta { display:inline-flex; padding:14px 25px; margin:32px 0; border-radius:2px; background:var(--brand-accent); color:#111!important; font-size:14px; font-weight:700; }
.service { position:relative; display:block; padding:30px 0; border-top:1px solid #ffffff25; } .service span { font-size:11px; color:var(--brand-accent); } .service h2 { font-size:23px; margin:10px 0; } .service p { max-width:500px; font-size:14px; } .service b { position:absolute; right:5px; top:35px; color:var(--brand-accent); }
.services { margin-top:75px; } .story { padding:45px 0; max-width:680px; } .story p { margin:20px 0; } .story h2 { font:32px/1.2 Georgia,serif; }
.base { display:flex; flex-wrap:wrap; justify-content:space-between; gap:24px; max-width:1240px; padding:30px 40px; margin:auto; border-top:1px solid #ffffff24; font-size:12px; } .base a { color:var(--brand-accent); }
a:focus-visible,summary:focus-visible { outline:3px solid var(--brand-accent); outline-offset:6px; } a:hover { opacity:.85; }
.site.${concept} { --concept-name:${concept}; }
${concept === "editorial" ? '.home-content { display:grid; grid-template-columns:1.15fr .85fr; gap:75px; align-items:start; } .home-content .services { margin:0; padding:15px 28px; background:#ffffff07; }' : concept === "momentum" ? '.intro { text-align:center; } .intro h1,.intro p { margin-left:auto;margin-right:auto; } .services { display:grid; grid-template-columns:repeat(3,1fr);gap:25px; } .service { padding:30px 25px; background:#ffffff08; }' : '.canvas { padding-top:70px; } .intro h1 { font-family:Arial,sans-serif;font-weight:650;max-width:1000px; } .service { display:grid;grid-template-columns:40px 1fr 1.2fr;gap:30px;align-items:start; } .service h2 { margin:0; }'}
@media(max-width:760px) { .top { padding:22px; } .top > nav { display:none; } .mobile-menu { display:block; position:relative; } .mobile-menu summary { cursor:pointer; } .mobile-menu nav { position:absolute; right:0; min-width:170px; padding:20px; display:flex; flex-direction:column; gap:14px; z-index:5; background:#20221e; border:1px solid #ffffff30; } .canvas { padding:65px 22px; } .home-content { display:block; } .home-content .services { margin-top:45px; } .services { display:block; margin-top:45px; } .service { display:block; } .service h2 { margin:10px 0; } .base { padding:25px 22px; } }
@media(prefers-reduced-motion:reduce) { .site * { scroll-behavior:auto; transition:none; } }
`;
  const pages = websitePaths(spec).map((path) => {
    const service = spec.services.find((item) => path === `/services/${item.slug}`);
    const headline = path === "/" ? spec.hero.headline : service?.name || (path === "/services" ? spec.servicesIntro.title : path === "/about" ? `About ${profile.businessName}` : "Let's find your next step.");
    const intro = service?.pageIntro || (path === "/about" ? spec.about.body : path === "/contact" ? spec.contact.copy : spec.hero.subheadline);
    const content = `<div class="intro"><span class="eyebrow">${escape(profile.businessType)} · ${escape(profile.location)}</span><h1>${escape(headline)}</h1><p>${escape(intro)}</p><a class="cta" href="action:booking">Request service ↗</a></div>`;
    const body = path === "/" ? `<div class="home-content">${content}<section class="services">${services}</section></div>` : `${content}${path === "/services" ? `<section class="services">${services}</section>` : `<section class="story"><h2>${escape(service?.pageSections[0]?.title || "A clear path to the team.")}</h2><p>${escape(service?.pageSections[0]?.copy || profile.description)}</p><p>${escape(profile.serviceArea)} · ${escape(profile.hours)}</p></section>`}`;
    return { path, title: `${headline} | ${profile.businessName}`, description: spec.seo.description.slice(0, 350), html: `<div class="site ${concept}"><header class="top"><a class="brand" href="/">${title}</a><nav aria-label="Main navigation">${links}</nav><details class="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation">${links}</nav></details></header><main id="main" class="canvas">${body}</main><footer class="base"><span>${title}</span><a href="tel:${profile.phone.replace(/[^+\d]/g, "")}">${escape(profile.phone)}</a><a href="mailto:${profile.email}">${escape(profile.email)}</a><a href="action:chat">Ask our assistant</a></footer></div>` };
  });
  return { name: `${concept.charAt(0).toUpperCase()}${concept.slice(1)} concept`, rationale: `A distinct ${concept} composition for the approved service catalogue.`, css, pages };
}
