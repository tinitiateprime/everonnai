"use client";

import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  ["Platform", "/product"],
  ["How it works", "/how-it-works"],
  ["Industries", "/industries"],
  ["Pricing", "/pricing"],
  ["Resources", "/blog"],
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="nav-shell">
        <Link href="/" className="brand" aria-label="EverOnn.Ai home">
          <Image
            src="/everonn-brand-wordmark.png"
            alt="EverOnn.Ai"
            width={1695}
            height={295}
            priority
          />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links.map(([label, href]) => (
            <Link className={pathname === href ? "active" : ""} href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="nav-actions">
          <Link href="/demo" className="button button-ghost desktop-only">
            Book a demo
          </Link>
          <Link href="/get-started" className="button button-primary nav-cta">
            Get my free website preview
          </Link>
          <button
            className="menu-button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Toggle navigation"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {links.map(([label, href]) => (
            <Link href={href} key={href} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <Link href="/demo" onClick={() => setOpen(false)}>Book a demo</Link>
        </nav>
      )}
    </header>
  );
}
