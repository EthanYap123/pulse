"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createApi, type Api } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed_out"; user: null }
  | { status: "signed_in"; user: User };

type AuthContextValue = AuthState & {
  api: Api;
  /** True while a request has been waiting more than 3 s: the free API host may be waking up. */
  waking: boolean;
  signIn: (mode: "login" | "signup", email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type Session = {
  api: Api;
  /** The access token lives only in memory; the refresh token is an HttpOnly cookie. */
  setToken: (token: string | null) => void;
};

function createSession(
  setState: (state: AuthState) => void,
  setWaking: (waking: boolean) => void,
): Session {
  let token: string | null = null;
  const setToken = (next: string | null) => {
    token = next;
    if (!next) setState({ status: "signed_out", user: null });
  };
  const api = createApi({ getToken: () => token, setToken, onSlow: setWaking });
  return { api, setToken };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const [waking, setWaking] = useState(false);
  // Created once per page load and kept across renders.
  const [session] = useState(() => createSession(setState, setWaking));
  const { api } = session;

  useEffect(() => {
    let cancelled = false;
    api
      .refresh()
      .then((token) => (token ? api.get<User>("/me") : null))
      .then((user) => {
        if (!cancelled && user) setState({ status: "signed_in", user });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "signed_out", user: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function signIn(mode: "login" | "signup", email: string, password: string) {
    const { user, accessToken } = await api.post<{ user: User; accessToken: string }>(
      `/auth/${mode}`,
      { email, password },
    );
    session.setToken(accessToken);
    setState({ status: "signed_in", user });
  }

  async function signOut() {
    await api.post("/auth/logout").catch(() => undefined);
    session.setToken(null);
  }

  return (
    <AuthContext.Provider value={{ ...state, api, waking, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
