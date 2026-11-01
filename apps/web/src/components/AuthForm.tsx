"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@pulse/shared";
import { ApiError } from "@/lib/api";
import { field } from "@/lib/forms";
import { useAuth } from "./AuthProvider";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { status, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signed_in") router.replace("/dashboard");
  }, [status, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, field(form, "email"), field(form, "password"));
      router.push("/dashboard");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.errors[0]?.message ?? e.message)
          : "Couldn’t reach Pulse. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  return (
    <main className="narrow">
      <h1>{isSignup ? "Create your account" : "Sign in"}</h1>
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate={false}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? PASSWORD_MIN_LENGTH : 1}
            maxLength={128}
            required
          />
          {isSignup && <span className="hint">At least {PASSWORD_MIN_LENGTH} characters.</span>}
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="muted center">
        {isSignup ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New to Pulse? <Link href="/signup">Create an account</Link>
          </>
        )}
      </p>
    </main>
  );
}
