"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { ThemeControl } from "./ThemeControl";

export function Header() {
  const { status, user, signOut } = useAuth();
  const router = useRouter();
  return (
    <header className="site-header">
      <Link href={status === "signed_in" ? "/dashboard" : "/"} className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Pulse
      </Link>
      <div className="header-actions">
        <ThemeControl />
        {status === "signed_in" && (
          <>
            <span className="muted header-email">{user.email}</span>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void signOut().then(() => router.push("/"))}
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export function WakingBanner() {
  const { waking } = useAuth();
  if (!waking) return null;
  return (
    <div className="waking" role="status">
      Waking up the API. Free hosting sleeps when idle, so the first request can take up to a
      minute.
    </div>
  );
}

/** Wraps pages that need a signed-in user; sends everyone else to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "signed_out") router.replace("/login");
  }, [status, router]);
  if (status !== "signed_in") return <p className="muted center">Loading…</p>;
  return <>{children}</>;
}
