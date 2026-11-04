import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeControl } from "@/components/ThemeControl";

/** Public pages: no sign-in, no API. Status comes from the checker on the server. */
export default function StatusLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Pulse
        </Link>
        <div className="header-actions">
          <ThemeControl />
        </div>
      </header>
      {children}
    </>
  );
}
