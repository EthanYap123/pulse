"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RequireAuth } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError } from "@/lib/api";
import { formatMs, timeAgo } from "@/lib/format";
import type { Monitor, Project } from "@/lib/types";
import { field } from "@/lib/forms";
import { useData } from "@/lib/use-data";

/** How often the list refreshes its live status while open. */
const REFRESH_MS = 60_000;

function ProjectView({ projectId }: { projectId: string }) {
  const { api } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const data = useData(
    projectId,
    async () => {
      const [project, list] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<{ items: Monitor[] }>(`/projects/${projectId}/monitors`),
      ]);
      return { project, monitors: list.items };
    },
    REFRESH_MS,
  );

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      data.reload();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : "Something went wrong.",
      );
    }
  }

  async function addMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      await api.post(`/projects/${projectId}/monitors`, {
        name: field(form, "name"),
        url: field(form, "url"),
        method: field(form, "method"),
      });
      formEl.reset();
    });
  }

  if (data.status === "loading") return <p className="muted center">Loading…</p>;
  if (data.status === "error") {
    const missing = data.error instanceof ApiError && data.error.status === 404;
    return (
      <main className="page">
        <h1>{missing ? "Project not found" : "Couldn’t load this project"}</h1>
        <Link href="/dashboard">Back to projects</Link>
      </main>
    );
  }
  const { project, monitors } = data.data;

  async function deleteProject() {
    if (!window.confirm(`Delete ${project.name} and all its monitors and history?`)) return;
    await api.del(`/projects/${projectId}`);
    router.push("/dashboard");
  }

  return (
    <main className="page">
      <p className="small">
        <Link href="/dashboard">← Projects</Link>
      </p>
      <div className="page-head">
        <h1>{project.name}</h1>
        <p className="muted small">Status page /status/{project.slug} arrives in Phase 3</p>
      </div>

      {monitors.length === 0 ? (
        <p className="card muted">
          No monitors yet. Add a URL below; it’s checked every 5 minutes.
        </p>
      ) : (
        <ul className="monitor-list">
          {monitors.map((m) => (
            <li key={m.id} className="card monitor-row">
              <div className="monitor-main">
                <StatusBadge status={m.status} />
                <Link href={`/monitors/${m.id}`} className="monitor-name">
                  {m.name}
                </Link>
                <span className="muted small url">{m.url}</span>
              </div>
              <div className="monitor-meta small">
                <span>{formatMs(m.lastLatencyMs)}</span>
                <span className="muted">checked {timeAgo(m.lastCheckedAt)}</span>
              </div>
              <div className="monitor-actions">
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() =>
                    void run(() => api.post(`/monitors/${m.id}/${m.isPaused ? "resume" : "pause"}`))
                  }
                >
                  {m.isPaused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  className="button button-danger button-small"
                  onClick={() => {
                    if (window.confirm(`Delete ${m.name} and its history?`)) {
                      void run(() => api.del(`/monitors/${m.id}`));
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="card">
        <h2>Add a monitor</h2>
        <form className="form form-inline" onSubmit={(e) => void addMonitor(e)}>
          <label>
            Name
            <input name="name" required maxLength={60} placeholder="Homepage" />
          </label>
          <label className="grow">
            URL
            <input name="url" type="url" required placeholder="https://example.com/health" />
          </label>
          <label>
            Method
            <select name="method" defaultValue="GET">
              <option>GET</option>
              <option>HEAD</option>
            </select>
          </label>
          <button className="button" type="submit">
            Add monitor
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="danger-zone">
        <button type="button" className="button button-danger" onClick={() => void deleteProject()}>
          Delete project
        </button>
      </section>
    </main>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <RequireAuth>
      <ProjectView projectId={projectId} />
    </RequireAuth>
  );
}
