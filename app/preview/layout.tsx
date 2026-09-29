import type { Metadata } from "next";
import "./preview.css";

export const metadata: Metadata = {
  title: "Private website preview · EverOnn",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
