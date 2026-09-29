import Link from "next/link";
import { ArrowRight, Check, CircleCheck, MessageSquareText, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { AudioDemo } from "@/components/audio-demo";
import { LeadForm } from "@/components/lead-form";

type Detail = {
  kicker: string;
  title: string;
  intro: string;
  sectionTitle: string;
  items: string[];
};

const productDetails: Record<string, Detail> = {
  "ai-phone-front-desk": {
    kicker: "Answer",
    title: "A helpful first response for every business call.",
    intro: "EverOnn answers using information and instructions the business approves, captures the reason for the call, and transfers or summarizes the conversation.",
    sectionTitle: "AI Phone Front Desk",
    items: ["Business-branded greetings", "Call qualification and summaries", "Configurable human handoff"],
  },
  "ai-chat": {
    kicker: "Engage",
    title: "Turn website questions into organized opportunities.",
    intro: "The website assistant uses the same approved business knowledge as the phone agent, helping visitors find answers and take the next step.",
    sectionTitle: "AI Website Chat",
    items: ["Answers from approved business content", "Lead capture and next-step prompts", "Shared context across channels"],
  },
  website: {
    kicker: "Get found",
    title: "A professional website prepared for the business.",
    intro: "EverOnn creates a private website preview that the verified owner can review, correct, claim, and publish on the company’s own domain.",
    sectionTitle: "Business Website",
    items: ["Private preview before publishing", "Mobile and search-ready pages", "Forms, chat, and analytics included"],
  },
  booking: {
    kicker: "Convert",
    title: "Give each inquiry a clear, trackable next step.",
    intro: "Capture preferred times, schedule when connected systems permit, or create an organized appointment or estimate request for the team.",
    sectionTitle: "Booking & Requests",
    items: ["Appointment and estimate requests", "Calendar-ready workflows", "Customer confirmations"],
  },
  "crm-follow-up": {
    kicker: "Keep moving",
    title: "Keep customer details and next steps in one place.",
    intro: "EverOnn records inquiries, alerts the team, and supports consistent follow-up so opportunities do not disappear across voicemail, forms, and text threads.",
    sectionTitle: "Leads & Follow-Up",
    items: ["Unified lead inbox", "Conversation history", "Configurable follow-up"],
  },
  "local-seo-aeo": {
    kicker: "Be understood",
    title: "Clear business information for customers and search systems.",
    intro: "Structured pages, helpful answers, and consistent business information make it easier for customers and modern search experiences to understand the company.",
    sectionTitle: "Search-Ready Presence",
    items: ["Structured business content", "Local service pages", "Clear question-and-answer resources"],
  },
};

const industries: Record<string, { name: string; title: string; intro: string; conversations: string[]; intake: string[] }> = {
  locksmith: {
    name: "Locksmiths",
    title: "Every urgent call gets an immediate first response.",
    intro: "EverOnn helps independent locksmith companies answer around the clock, capture the location and service need, and route each opportunity under the company’s own brand.",
    conversations: ["Home and business lockouts", "Vehicle lock and key inquiries", "Rekeying and lock-change requests"],
    intake: ["Customer and service location", "Property or vehicle details", "Urgency and safe callback number"],
  },
  "roadside-towing": {
    name: "Roadside & Towing",
    title: "A responsive front desk for drivers who need help now.",
    intro: "EverOnn helps towing and roadside businesses collect location, vehicle, destination, and service details while dispatch teams stay focused on the road.",
    conversations: ["Tow and recovery requests", "Jump-start and battery inquiries", "Tire, fuel, and lockout assistance"],
    intake: ["Current location and safety status", "Vehicle and service needed", "Destination and callback number"],
  },
  hvac: {
    name: "HVAC",
    title: "A front desk that keeps up with every season.",
    intro: "EverOnn helps HVAC companies answer new inquiries, capture service details, request appointments, and keep customers informed under the company’s own brand.",
    conversations: ["Heating and cooling service requests", "Maintenance and tune-up inquiries", "Replacement estimate requests"],
    intake: ["Service address and coverage area", "System and issue details", "Preferred appointment window"],
  },
  plumbing: {
    name: "Plumbing",
    title: "Every plumbing inquiry gets a clear next step.",
    intro: "EverOnn gives plumbing businesses one connected system for their website, phone, chat, appointment requests, and customer follow-up.",
    conversations: ["Repair and service inquiries", "Drain and water-heater requests", "Estimate and project inquiries"],
    intake: ["Property and service location", "Problem description", "Availability and callback preference"],
  },
  "garage-door": {
    name: "Garage Door",
    title: "Answer customers even when both hands are on the job.",
    intro: "EverOnn helps garage-door companies capture repair and installation opportunities, gather useful details, and route them to the right person.",
    conversations: ["Repair and opener inquiries", "Installation estimates", "Existing appointment questions"],
    intake: ["Door type and issue", "Property location", "Photo or callback request"],
  },
  cleaning: {
    name: "Cleaning Services",
    title: "More quote requests handled. Less office work.",
    intro: "EverOnn helps residential and commercial cleaning companies respond to quote requests, collect property details, arrange walkthroughs, and follow up consistently.",
    conversations: ["Residential and recurring cleaning", "Commercial and office walkthroughs", "Move-in, move-out, and deep cleaning"],
    intake: ["Property type and size", "Frequency and service scope", "Preferred start date or walkthrough"],
  },
};

const allIndustries = [
  ["Locksmiths", "Answer urgent lockout calls before the customer tries the next listing.", "locksmith"],
  ["Roadside & Towing", "Capture stranded drivers’ locations and needs without making them wait.", "roadside-towing"],
  ["HVAC", "Keep service calls moving while your team is in the field.", "hvac"],
  ["Plumbing", "Capture the details before the customer calls someone else.", "plumbing"],
  ["Garage Door", "Turn calls from the driveway into organized service requests.", "garage-door"],
  ["Cleaning Services", "Qualify residential and commercial requests around the clock.", "cleaning"],
] as const;

function Hero({ kicker, title, intro }: { kicker: string; title: string; intro: string }) {
  return (
    <section className="page-hero">
      <div className="container reveal">
        <span className="section-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        <div className="page-hero-actions">
          <Link className="button button-primary" href="/get-started">Get my free website preview <ArrowRight /></Link>
          <Link className="button button-dark" href="/demo">Book a demo</Link>
        </div>
      </div>
    </section>
  );
}

function ProductDetailPage({ detail }: { detail: Detail }) {
  return (
    <main id="main">
      <Hero kicker={detail.kicker} title={detail.title} intro={detail.intro} />
      <section className="content-section">
        <div className="container centered-heading">
          <span className="section-kicker">What it includes</span>
          <h2>{detail.sectionTitle}, without unnecessary complexity.</h2>
        </div>
        <div className="container detail-grid">
          {detail.items.map((item) => (
            <article className="detail-card" key={item}>
              <CircleCheck />
              <h3>{item}</h3>
              <p>Configured around the business’s approved information, workflow, and customer-response rules.</p>
            </article>
          ))}
        </div>
      </section>
      <section className="content-section section-dark">
        <div className="container callout dark-callout">
          <h2>The business stays in control.</h2>
          <p>EverOnn provides the technology. The independent business controls its customers, services, prices, availability, and operational decisions.</p>
        </div>
      </section>
    </main>
  );
}

function IndustryDetailPage({ industry }: { industry: (typeof industries)[string] }) {
  return (
    <main id="main">
      <Hero kicker={`EverOnn for ${industry.name} companies`} title={industry.title} intro={industry.intro} />
      <section className="content-section">
        <div className="container centered-heading">
          <span className="section-kicker">Customer conversations</span>
          <h2>Give common inquiries a consistent first response.</h2>
          <p>EverOnn uses information and instructions the business approves. It captures the request and creates the next step; the company remains responsible for delivering its service.</p>
        </div>
        <div className="container detail-grid">
          {industry.conversations.map((item) => (
            <article className="detail-card" key={item}><MessageSquareText /><h3>{item}</h3><p>Answer common questions, gather relevant details, and route the opportunity according to the business’s rules.</p></article>
          ))}
        </div>
      </section>
      <section className="content-section light-section">
        <div className="container split-heading"><div><span className="section-kicker">A useful intake</span><h2>Capture details the team can act on.</h2></div></div>
        <div className="container detail-grid">
          {industry.intake.map((item) => <article className="detail-card" key={item}><Check /><h3>{item}</h3></article>)}
        </div>
      </section>
      <section className="content-section"><div className="container callout"><strong>EverOnn provides technology—not {industry.name.toLowerCase()} services.</strong><p>Customers contact the independent business directly. EverOnn works behind that business’s brand to support the conversation.</p></div></section>
    </main>
  );
}

function ProductPage() {
  return (
    <main id="main">
      <Hero kicker="The EverOnn platform" title="Your customer front, working as one." intro="Bring the business website, calls, chat, appointment requests, follow-up, and customer context into one approachable system." />
      <section className="content-section section-dark">
        <div className="container centered-heading"><span className="section-kicker">Build in layers</span><h2>Start where the business needs help most.</h2><p>EverOnn is designed to add capability without forcing a small business to replace every tool it already uses.</p></div>
        <div className="container feature-grid">
          {Object.entries(productDetails).map(([slug, item]) => <Link className="feature-card" href={`/product/${slug}`} key={slug}><div className="icon-box"><Sparkles /></div><span>{item.kicker}</span><h3>{item.sectionTitle}</h3><p>{item.intro}</p><strong>Learn more <ArrowRight /></strong></Link>)}
        </div>
      </section>
      <section className="content-section"><div className="container callout"><span className="section-kicker">The principle</span><h2>One approved source of business knowledge.</h2><p>Hours, services, coverage, common questions, and handoff rules should not conflict between the website, phone, and chat. EverOnn keeps the customer-facing experience aligned.</p></div></section>
    </main>
  );
}

function HowItWorksPage() {
  const steps = [
    ["Share the business", "Provide the business name, existing website or public listing, and your contact details."],
    ["Review the private concept", "EverOnn prepares a website concept for the verified owner to review and correct. Nothing becomes official without approval."],
    ["Approve the business knowledge", "Confirm services, hours, coverage, FAQs, customer policies, and human handoff instructions."],
    ["Connect the channels", "Publish the website, connect the appropriate phone setup, and activate chat or booking workflows."],
    ["Improve from real conversations", "Review inquiries, refine approved answers, and measure customer-response outcomes over time."],
  ];
  return <main id="main"><Hero kicker="A guided start" title="From business information to a working customer front." intro="EverOnn reduces setup by preparing the first experience, then puts the verified business owner in control of what goes live." /><section className="content-section"><div className="container process-list">{steps.map(([title, copy], index) => <article className="process-row" key={title}><b>Step {String(index + 1).padStart(2, "0")}</b><div><h2>{title}</h2><p>{copy}</p></div></article>)}</div></section><section className="content-section light-section"><div className="container callout"><h2>Owner control</h2><p>Your brand, customers, and operating decisions remain yours.</p><ul className="check-grid">{["Review before publishing", "Approve business information", "Choose handoff rules", "Control connected systems", "Update or cancel according to your plan"].map(item => <li key={item}><Check /> {item}</li>)}</ul><Link className="button button-primary inline-cta" href="/get-started">Request your private preview</Link></div></section></main>;
}

function IndustriesPage() {
  return <main id="main"><Hero kicker="Industry-ready starting points" title="Technology shaped around the way your business responds." intro="EverOnn is one platform for small businesses. Industry packages make the website, intake questions, and customer journey feel relevant from day one." /><section className="content-section"><div className="container industry-grid industries-page-grid">{allIndustries.map(([title, copy, slug], index) => <article className="industry-card" key={slug}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{copy}</p><Link href={`/industries/${slug}`}><strong>Explore {title} <ArrowRight /></strong></Link></article>)}</div></section><section className="content-section light-section"><div className="container callout"><span className="section-kicker">A horizontal platform</span><h2>Your industry changes the configuration—not who EverOnn is.</h2><p>EverOnn does not provide the underlying service and does not operate a marketplace. It powers the independent business that serves the customer.</p></div></section></main>;
}

const plans = [
  ["Website", "$19", "A professional online presence with a simple path to contact.", ["Private website preview", "Hosting and domain connection", "Lead forms", "Basic website analytics"]],
  ["Front Desk", "$79", "Phone and website conversations organized in one customer front.", ["Everything in Website", "AI phone answering", "AI website chat", "Lead inbox and summaries", "Included usage allowance"]],
  ["Growth", "$149", "For teams ready to add booking, follow-up, and clearer reporting.", ["Everything in Front Desk", "Booking and estimate workflows", "Text and email follow-up", "Review workflows", "Expanded reporting and usage"]],
] as const;

function PricingPage() {
  return <main id="main"><Hero kicker="Straightforward plans" title="See it free. Pay only when you publish." intro="Your private website preview costs nothing. Approve it, publish it, and connect your domain for $19/month—or add the AI front desk your business needs." /><section className="content-section pricing-section"><div className="container pricing-bridge"><article><span>Preview</span><strong>Free</strong><p>See your custom site before paying a cent. It stays private until you approve it.</p></article><ArrowRight /><article><span>Website</span><strong>$19/month</strong><p>Publish the approved site, connect your domain, and go live.</p></article></div><div className="container roi-banner"><strong>Less than one missed job:</strong> if a missed opportunity is worth $150, Front Desk at $79/month can pay for itself by capturing one.</div><div className="container pricing-grid">{plans.map(([name, price, copy, items], index) => <article className={`price-card ${index === 1 ? "popular" : ""}`} key={name}>{index === 1 && <span className="popular-label">Most popular</span>}<h3>{name}</h3><div className="price"><sup>$</sup>{price.slice(1)}<small>/month</small></div><p>{copy}</p><ul>{items.map(item => <li key={item}><Check /> {item}</li>)}</ul><Link className={`button ${index === 1 ? "button-primary" : "button-outline"}`} href={index === 2 ? "/demo" : "/get-started"}>{index === 2 ? "Book a walkthrough" : "Get my free website preview"}</Link></article>)}</div></section></main>;
}

function AboutPage() {
  const values = [["Prepared, not complicated", "Begin with a relevant private website concept and a guided setup."], ["The owner is the hero", "EverOnn works behind the business’s brand. It does not take over the customer relationship."], ["Proof before promises", "Publish verified results, disclose limitations, and keep customer-facing information approved."]];
  return <main id="main"><Hero kicker="Why EverOnn" title="Small businesses deserve technology that feels prepared for them." intro="EverOnn is being built to give independent businesses an approachable website and customer front without requiring an enterprise team or a pile of disconnected tools." /><section className="content-section"><div className="container centered-heading"><span className="section-kicker">Our mission</span><h2>Help every small business be ready to respond.</h2><p>Customers expect clear, timely answers. Owners need to stay focused on delivering their work. EverOnn connects those needs while keeping the business in control.</p></div><div className="container value-grid">{values.map(([title, copy]) => <article className="value-card" key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></section><section className="content-section light-section"><div className="container callout"><h2>Always onn</h2><p>The second “n” is intentional. It represents the state we want to help create: the business website, phone, chat, and follow-up ready to help even when the owner is busy.</p></div></section></main>;
}

function ResultsPage() {
  return <main id="main"><Hero kicker="Customer results" title="Measured stories, published with permission." intro="EverOnn will publish named case studies only after pilots produce verified data and customers approve the story." /><section className="content-section"><div className="container callout"><span className="section-kicker">Pilot program</span><h2>Verified case studies are being prepared.</h2><p>No invented customer logos, testimonials, call volumes, bookings, or revenue claims. Until evidence is ready, product demonstrations and clearly labeled estimates do the talking.</p><Link className="button button-primary inline-cta" href="/demo">Discuss a pilot</Link></div></section><section className="content-section light-section"><div className="container centered-heading"><span className="section-kicker">What we will measure</span><h2>Customer response—not vanity metrics.</h2></div><div className="container detail-grid">{[["Inquiries answered", "How many phone and website conversations received a response."], ["Useful outcomes", "Qualified inquiries, appointment requests, estimate requests, and human handoffs."], ["Operational impact", "Response time, owner follow-up, and customer-reported business outcomes."]].map(([title, copy]) => <article className="detail-card" key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div></section></main>;
}

function BlogPage() {
  const posts = [["Guide", "What an AI front desk should—and should not—do", "A plain-language framework for owner control, approved business knowledge, and human handoff."], ["Playbook", "From website visitor to organized opportunity", "How website, phone, chat, and follow-up can share one customer journey."], ["EverOnn", "The private website preview explained", "What the preview is, how ownership is verified, and when a concept becomes an official business website."]];
  return <main id="main"><Hero kicker="Small business resources" title="Clear guidance for an always-ready customer front." intro="Practical explanations for business owners—without marketing automation jargon." /><section className="content-section"><div className="container blog-grid">{posts.map(([type, title, copy]) => <article className="blog-card" key={title}><span className="section-kicker">{type}</span><h3>{title}</h3><p>{copy}</p><span className="text-link">Read the guide <ArrowRight /></span></article>)}</div></section></main>;
}

function FormPage({ kind }: { kind: "demo" | "preview" }) {
  const demo = kind === "demo";
  return <main id="main"><Hero kicker={demo ? "Experience the customer front" : "Private website preview"} title={demo ? "Hear the response. Then see the full journey." : "See what EverOnn could build around your business."} intro={demo ? "Start with an illustrative greeting or request a guided demonstration configured around your business." : "Submit the business details. We’ll prepare or review a private concept and contact you before anything is published."} /><section className="content-section"><div className="container lead-panel"><div><span className="section-kicker">{demo ? "Guided walkthrough" : "Build before asking"}</span><h2>{demo ? "Show us how customers reach you today." : "Low risk. Clear next step."}</h2><p>{demo ? "We’ll map the website, phone, chat, and follow-up experience around the business rather than presenting a generic software tour." : "The preview is an independent concept created for evaluation. It does not represent the business publicly until ownership is verified and publication is approved."}</p></div><LeadForm kind={kind} /></div></section>{demo && <section className="content-section section-dark"><div className="container demo-grid"><div><span className="section-kicker">Voice sample</span><h2>A first impression customers can act on.</h2><p>The production agent is configured using approved business information, conversation rules, and human handoff instructions.</p></div><AudioDemo /></div></section>}</main>;
}

function LegalPage({ title }: { title: string }) {
  return <main id="main"><section className="page-hero"><div className="container"><span className="section-kicker">Legal</span><h1>{title}</h1><p>Effective September 29, 2026</p></div></section><section className="content-section"><div className="container legal"><p>This page explains EverOnn’s practices and the terms that apply when using the website and related services.</p><h2>Information and service use</h2><p>EverOnn provides websites and customer-response technology to independent businesses. Each business remains responsible for its services, prices, availability, and customer commitments.</p><h2>Privacy and communications</h2><p>Information submitted through forms is used to respond to requests, prepare demonstrations, and provide the services requested. Marketing calls or texts require the consent shown with the relevant form.</p><h2>Questions</h2><p>Contact EverOnn through the demo request form if you have questions about this policy.</p></div></section></main>;
}

export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const path = slug.join("/");
  if (path === "product") return <ProductPage />;
  if (path === "how-it-works") return <HowItWorksPage />;
  if (path === "industries") return <IndustriesPage />;
  if (path === "pricing") return <PricingPage />;
  if (path === "about") return <AboutPage />;
  if (path === "results") return <ResultsPage />;
  if (path === "blog") return <BlogPage />;
  if (path === "demo") return <FormPage kind="demo" />;
  if (path === "get-started") return <FormPage kind="preview" />;
  if (slug[0] === "product" && slug[1] && productDetails[slug[1]]) return <ProductDetailPage detail={productDetails[slug[1]]} />;
  if (slug[0] === "industries" && slug[1] && industries[slug[1]]) return <IndustryDetailPage industry={industries[slug[1]]} />;
  if (slug[0] === "legal" && slug[1]) {
    const titles: Record<string, string> = { privacy: "Privacy policy", terms: "Terms of service", "messaging-consent": "Messaging consent" };
    if (titles[slug[1]]) return <LegalPage title={titles[slug[1]]} />;
  }
  notFound();
}
