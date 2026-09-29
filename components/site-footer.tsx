import Image from "next/image";
import Link from "next/link";

const groups = [
  {
    title: "Platform",
    links: [
      ["Website", "/product/website"],
      ["AI phone", "/product/ai-phone-front-desk"],
      ["AI chat", "/product/ai-chat"],
      ["Pricing", "/pricing"],
    ],
  },
  {
    title: "Industries",
    links: [
      ["Locksmiths", "/industries/locksmith"],
      ["Roadside & towing", "/industries/roadside-towing"],
      ["HVAC", "/industries/hvac"],
      ["Plumbing", "/industries/plumbing"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Results", "/results"],
      ["Resources", "/blog"],
      ["Contact", "/demo"],
      ["Client login", "/login"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Privacy", "/legal/privacy"],
      ["Terms", "/legal/terms"],
      ["Messaging consent", "/legal/messaging-consent"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" aria-label="EverOnn.Ai home">
            <Image src="/everonn-brand-wordmark.png" alt="EverOnn.Ai" width={1695} height={295} />
          </Link>
          <p>Websites and AI customer-response technology for small businesses.</p>
          <span className="always-onn">
            <i /> Always onn
          </span>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <h3>{group.title}</h3>
            {group.links.map(([label, href]) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <span>© 2026 EverOnn.Ai · “Always onn” is intentional.</span>
        <span>
          EverOnn provides technology—not the underlying services. Fictional scenarios are labeled and
          are not customer testimonials.
        </span>
      </div>
    </footer>
  );
}
