import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "EverOnn — Website Studio",
  description:
    "Turn business knowledge into three original AI-designed websites.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
