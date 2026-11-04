import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pulse", template: "%s · Pulse" },
  description: "Uptime monitoring with public status pages.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Only what every page shares. Sign-in lives in (app)/layout.tsx so public status pages
 * never call the API, which would wake it (and Postgres) for every visitor.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script sets data-theme before paint; React would otherwise warn about it.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
