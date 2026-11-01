"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { RequireAuth } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import type { Me, Project } from "@/lib/types";
import { field, useData } from "@/lib/use-data";

function Dashboard() {
  const { api } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const data = useData("dashboard", async () => {
    const [list, me] = await Promise.all([
      api.get<{ items: Project[] }>("/projects"),
      api.get<Me>("/me"),
    ]);
    return { projects: list.items, me };
  });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setError(null);
    try {
      await api.post("/projects", { name: field(form, "name"), slug: field(form, "slug") });
      formEl.reset();
      data.reload();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : "Something went wrong.",
      );
    }
  }

  if (data.status === "loading") return <p className="muted center">Loading…</p>;
  if (data.status === "error") {
    return <p className="error center">Couldn’t load your projects. Refresh to try again.</p>;
  }
  const { projects, me } = data.data;
  const atLimit = me.usage.projects >= me.limits.projects;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <p className="muted small">
          {me.usage.projects} of {me.limits.projects} projects · {me.usage.monitors} of{" "}
          {me.limits.monitors} monitors
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="card muted">No projects yet. Create one to start adding monitors.</p>
      ) : (
        <ul className="grid">
          {projects.map((p) => (
            <li key={p.id}>
              <Link className="card card-link" href={`/projects/${p.id}`}>
                <strong>{p.name}</strong>
                <span className="muted small">/status/{p.slug}</span>
                <span className="small">
                  {p.monitorCount} {p.monitorCount === 1 ? "monitor" : "monitors"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="card">
        <h2>New project</h2>
        {atLimit ? (
          <p className="muted">You’ve reached the free limit of {me.limits.projects} projects.</p>
        ) : (
          <form className="form form-inline" onSubmit={(e) => void create(e)}>
            <label>
              Name
              <input name="name" required maxLength={60} placeholder="My app" />
            </label>
            <label>
              Status page address
              <input
                name="slug"
                required
                minLength={3}
                maxLength={40}
                pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                placeholder="my-app"
                title="3-40 lowercase letters, numbers or hyphens"
              />
            </label>
            <button className="button" type="submit">
              Create project
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}
