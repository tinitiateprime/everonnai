import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarCheck,
  Check,
  Clock3,
  Earth,
  Headphones,
  MessageCircleMore,
  MessageSquareText,
  PhoneCall,
  SearchCheck,
  Sparkles,
} from "lucide-react";
import { AudioDemo } from "@/components/audio-demo";

const features = [
  {
    label: "Answer",
    title: "AI Phone Front Desk",
    copy: "A helpful first response for every business call.",
    href: "/product/ai-phone-front-desk",
    icon: Headphones,
  },
  {
    label: "Engage",
    title: "AI Website Chat",
    copy: "Turn website questions into organized opportunities.",
    href: "/product/ai-chat",
    icon: MessageSquareText,
  },
  {
    label: "Get found",
    title: "Business Website",
    copy: "A professional website prepared for the business.",
    href: "/product/website",
    icon: Earth,
  },
  {
    label: "Convert",
    title: "Booking & Requests",
    copy: "Give each inquiry a clear, trackable next step.",
    href: "/product/booking",
    icon: CalendarCheck,
  },
  {
    label: "Keep moving",
    title: "Leads & Follow-Up",
    copy: "Keep customer details and next steps in one place.",
    href: "/product/crm-follow-up",
    icon: Sparkles,
  },
  {
    label: "Be understood",
    title: "Search-Ready Presence",
    copy: "Clear business information for customers and search systems.",
    href: "/product/local-seo-aeo",
    icon: SearchCheck,
  },
];

const industries = [
  ["Locksmiths", "Answer urgent lockout calls before the customer tries the next listing.", "locksmith"],
  ["Roadside & Towing", "Capture stranded drivers’ locations and needs without making them wait.", "roadside-towing"],
  ["HVAC", "Keep service calls moving while your team is in the field.", "hvac"],
  ["Plumbing", "Capture the details before the customer calls someone else.", "plumbing"],
  ["Garage Door", "Turn calls from the driveway into organized service requests.", "garage-door"],
  ["Cleaning Services", "Qualify residential and commercial requests around the clock.", "cleaning"],
] as const;

const plans = [
  {
    name: "Website",
    price: 19,
    description: "A professional online presence with a simple path to contact.",
    items: ["Private website preview", "Hosting and domain connection", "Lead forms", "Basic website analytics"],
    button: "Get my free website preview",
    href: "/get-started",
  },
  {
    name: "Front Desk",
    price: 79,
    description: "Phone and website conversations organized in one customer front.",
    items: ["Everything in Website", "AI phone answering", "AI website chat", "Lead inbox and summaries", "Included usage allowance"],
    button: "Get my free website preview",
    href: "/get-started",
    popular: true,
  },
  {
    name: "Growth",
    price: 149,
    description: "For teams ready to add booking, follow-up, and clearer reporting.",
    items: ["Everything in Front Desk", "Booking and estimate workflows", "Text and email follow-up", "Review workflows", "Expanded reporting and usage"],
    button: "Book a walkthrough",
    href: "/demo",
  },
];

const faqs = [
  ["Does EverOnn provide my company’s services?", "No. EverOnn provides website and customer-response technology to independent businesses. Your company delivers its own services."],
  ["Can I keep my current phone number?", "The intended setup supports forwarding or connecting an existing business number. Final availability depends on the selected phone configuration."],
  ["What happens when the AI cannot answer?", "You choose the approved information and handoff rules. EverOnn can transfer the conversation or capture a clear message for a person."],
  ["Will my preview be public?", "No. A generated concept remains private and non-official until a verified business owner reviews and authorizes publication."],
] as const;

export default function HomePage() {
  return (
    <main id="main">
      <section className="hero section-dark">
        <div className="hero-glow" />
        <div className="container hero-grid">
          <div className="hero-copy reveal">
            <span className="eyebrow"><i className="live-dot" /> The AI front desk for small business</span>
            <h1>
              Never miss another call. <span className="gradient-text">Never miss another customer.</span>
            </h1>
            <p className="hero-lede">
              EverOnn answers your phone, chat, and website day and night—captures each opportunity and
              sends your team the details. Your private website preview is free.
            </p>
            <div className="roi-chip">
              <strong>Simple ROI:</strong> if one missed job is worth $150, Front Desk at $79/month can pay
              for itself with one captured opportunity.
            </div>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/get-started">
                Get my free website preview <ArrowRight />
              </Link>
              <a className="button button-dark button-large" href="#hear-it">
                <PhoneCall /> Hear EverOnn answer
              </a>
            </div>
            <div className="hero-trust">
              <span><Check /> Private until you approve it</span>
              <span><Check /> Keep your brand and phone number</span>
            </div>
          </div>
          <div className="hero-visual reveal delay-1" aria-label="A customer inquiry moving through EverOnn">
            <div className="signal-orbit">
              <div className="signal-core">
                <PhoneCall />
                <span>Incoming call</span>
                <strong>Customer inquiry</strong>
              </div>
              <i className="orbit orbit-one" />
              <i className="orbit orbit-two" />
            </div>
            <div className="flow-card card-answer"><span className="status-dot" /> EverOnn answered <small>now</small></div>
            <div className="flow-card card-detail">
              <MessageCircleMore />
              <div><small>Reason captured</small><strong>Service request</strong></div>
            </div>
            <div className="flow-card card-owner">
              <BellRing />
              <div><small>Owner notified</small><strong>Clear next step</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="trust-bar">
        <div className="container trust-row">
          <span><BadgeCheck /> Built for independent small businesses</span>
          <span><Clock3 /> Customer response around the clock</span>
          <span><Sparkles /> One approved business knowledge base</span>
        </div>
      </section>

      <section className="section light-section">
        <div className="container split-heading">
          <div>
            <span className="section-kicker">The customer-response gap</span>
            <h2>Good businesses lose opportunities between the ring and the reply.</h2>
          </div>
          <p>
            A website form, voicemail, calendar, and text thread should not operate like separate businesses.
            EverOnn connects the first customer interaction to a clear next step.
          </p>
        </div>
        <div className="container before-after">
          <div className="compare-card before">
            <span>Before EverOnn</span>
            <h3>Every channel creates another loose end.</h3>
            <ul>
              <li>Calls reach voicemail while the team is working</li>
              <li>Website inquiries wait in an inbox</li>
              <li>Customer details live in separate places</li>
              <li>Follow-up depends on someone remembering</li>
            </ul>
          </div>
          <div className="compare-bridge"><ArrowRight /></div>
          <div className="compare-card after">
            <span>With EverOnn</span>
            <h3>Every inquiry becomes an organized opportunity.</h3>
            <ul>
              <li>Phone and chat respond using approved information</li>
              <li>Requests are qualified consistently</li>
              <li>The team receives a useful summary</li>
              <li>Customers get confirmation and a next step</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section section-dark platform-section">
        <div className="container centered-heading">
          <span className="section-kicker">One customer front</span>
          <h2>One business brain across every channel.</h2>
          <p>
            Start with a professional website. Add the customer-response capabilities your business
            needs—without rebuilding the experience each time.
          </p>
        </div>
        <div className="container feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Link className="feature-card" href={feature.href} key={feature.title}>
                <div className="icon-box"><Icon /></div>
                <span>{feature.label}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <strong>Explore <ArrowRight /></strong>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section how-section">
        <div className="container centered-heading">
          <span className="section-kicker">Prepared before purchase</span>
          <h2>See the possibility before you commit.</h2>
          <p>
            Your preview is an independent concept—not an official public site—until a verified owner
            reviews and approves it.
          </p>
        </div>
        <div className="container steps-grid">
          <article><b>01</b><h3>Tell us about the business</h3><p>Share the business name, current website or listing, and the best way to reach you.</p></article>
          <article><b>02</b><h3>Review a private preview</h3><p>Check the pages, services, brand, and business information before anything is published.</p></article>
          <article><b>03</b><h3>Turn on your customer front</h3><p>Connect the domain, approve the AI knowledge, and activate the channels you want.</p></article>
        </div>
        <div className="center-action">
          <Link className="text-link" href="/how-it-works">See how onboarding works <ArrowRight /></Link>
        </div>
      </section>

      <section id="hear-it" className="section audio-section section-dark">
        <div className="container demo-grid">
          <div>
            <span className="section-kicker">Hear the difference</span>
            <h2>A helpful answer is more convincing than another feature list.</h2>
            <p>
              Listen to an illustrative greeting, then imagine it configured with your business name,
              services, hours, and handoff rules.
            </p>
            <Link className="button button-primary" href="/demo">Experience the demo <ArrowRight /></Link>
          </div>
          <AudioDemo />
        </div>
      </section>

      <section className="section industries-section">
        <div className="container split-heading">
          <div>
            <span className="section-kicker">Built around your business</span>
            <h2>One platform. Industry-ready starting points.</h2>
          </div>
          <p>
            EverOnn is technology for small businesses. Industry packages help configure the website,
            intake questions, and customer journey faster.
          </p>
        </div>
        <div className="container industry-grid">
          {industries.map(([title, copy, slug], index) => (
            <article className="industry-card" key={slug} style={{ "--card-accent": index % 2 ? "#5b8cff" : "#38e0c4" } as React.CSSProperties}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
              <Link href={`/industries/${slug}`}><strong>See the industry experience <ArrowRight /></strong></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section pricing-section">
        <div className="container centered-heading">
          <span className="section-kicker">Simple starting points</span>
          <h2>Costs less than one missed job a month.</h2>
          <p>
            Your private preview is free. Publish it and connect your domain for $19/month; add phone and
            chat response with Front Desk for $79/month. No pageview billing.
          </p>
        </div>
        <div className="container pricing-grid">
          {plans.map((plan) => (
            <article className={`price-card ${plan.popular ? "popular" : ""}`} key={plan.name}>
              {plan.popular && <span className="popular-label">Most popular</span>}
              <h3>{plan.name}</h3>
              <div className="price"><sup>$</sup>{plan.price}<small>/month</small></div>
              <p>{plan.description}</p>
              <ul>
                {plan.items.map((item) => <li key={item}><Check /> {item}</li>)}
              </ul>
              <Link className={`button ${plan.popular ? "button-primary" : "button-outline"}`} href={plan.href}>{plan.button}</Link>
            </article>
          ))}
        </div>
        <div className="center-action">
          <Link className="text-link" href="/pricing">Compare all plans and usage <ArrowRight /></Link>
        </div>
      </section>

      <section className="section sample-proof">
        <div className="container centered-heading">
          <span className="section-kicker">Illustrative customer scenarios</span>
          <h2>Picture what a captured opportunity could look like.</h2>
        </div>
        <div className="container testimonial-grid">
          <article><span>Sample scenario · Locksmith</span><blockquote>“I was under a car when the call came in—EverOnn captured the address and texted me the job details.”</blockquote><strong>Illustrative mobile-locksmith scenario</strong></article>
          <article><span>Sample scenario · HVAC</span><blockquote>“During the first cold snap, after-hours callers received an immediate response and a clear next step.”</blockquote><strong>Illustrative HVAC scenario</strong></article>
          <article><span>Sample scenario · Roadside</span><blockquote>“The assistant collected the stranded driver’s location and vehicle details while the team stayed on the road.”</blockquote><strong>Illustrative roadside scenario</strong></article>
        </div>
        <div className="container sample-disclaimer">
          <strong>Important:</strong> These are fictional product scenarios—not real customer testimonials or measured results. Verified customer stories will replace them after the pilot program and customer approval.
          <Link href="/results">See our evidence policy <ArrowRight /></Link>
        </div>
      </section>

      <section className="section faq-section">
        <div className="container faq-grid">
          <div>
            <span className="section-kicker">Questions, answered</span>
            <h2>Clear expectations from the first conversation.</h2>
            <p>
              EverOnn supports the customer front. Your business remains in control of its services,
              customers, prices, and decisions.
            </p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}<i>+</i></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="final-cta section-dark">
        <div className="container">
          <span className="pulse-mark">∞</span>
          <h2>Your next customer is already looking for an answer.</h2>
          <p>Let’s make sure your business is ready to respond.</p>
          <div>
            <Link className="button button-primary button-large" href="/get-started">Get my free website preview <ArrowRight /></Link>
            <Link className="button button-dark button-large" href="/demo">Book a demo</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
