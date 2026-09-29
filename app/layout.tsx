import type { Metadata } from "next";
import "./globals.css";
import { AppChrome } from "@/components/app-chrome";

export const metadata: Metadata = {
  title: "The AI Front Desk for Small Business",
  description:
    "EverOnn brings your business website, phone, chat, booking, and customer follow-up together under your brand.",
  applicationName: "EverOnn.Ai",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
