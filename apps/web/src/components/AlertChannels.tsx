"use client";

import { useState, type FormEvent } from "react";
import { ApiError, type Api } from "@/lib/api";
import { field } from "@/lib/forms";
import type { Channel } from "@/lib/types";

const DISABLED_REASON: Record<string, string> = {
  webhook_deleted:
    "Discord says this webhook was deleted. Paste a new webhook URL to turn it back on.",
  webhook_unauthorized:
    "Discord rejected this webhook. Paste a new webhook URL to turn it back on.",
  turned_off: "Turned off.",
};

type Props = {
  api: Api;
  projectId: string;
  channels: Channel[];
  onChange: () => void;
};

/** A project's alert channels: add a Discord webhook, send a test, turn off, delete. */
export function AlertChannels({ api, projectId, channels, onChange }: Props) {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, success?: string) {
    setMessage(null);
    try {
      await action();
      if (success) setMessage({ kind: "ok", text: success });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : "Something went wrong.",
      });
    }
    onChange();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      await api.post(`/projects/${projectId}/channels`, {
        type: "discord",
        name: field(form, "name"),
        webhookUrl: field(form, "webhookUrl"),
      });
      formEl.reset();
    }, "Channel added. Send a test to check it works.");
  }

  return (
    <section className="card">
      <h2>Alerts</h2>
      <p className="muted small">
        Pulse posts here when a monitor goes down and when it recovers. A monitor that flaps is only
        announced once per cooldown.
      </p>

      {channels.length > 0 && (
        <ul className="channel-list">
          {channels.map((c) => (
            <li key={c.id} className="channel-row">
              <div>
                <strong>{c.name}</strong>{" "}
                <span className={`badge ${c.state === "active" ? "badge-up" : "badge-paused"}`}>
                  {c.state === "active" ? "On" : "Off"}
                </span>
                <div className="muted small">
                  Discord · {c.target} · cooldown {c.cooldownMinutes} min
                </div>
                {c.state === "disabled" && c.disabledReason && (
                  <div className="small error">
                    {DISABLED_REASON[c.disabledReason] ?? c.disabledReason}
                  </div>
                )}
              </div>
              <div className="monitor-actions">
                {c.state === "active" && (
                  <button
                    type="button"
                    className="button button-quiet button-small"
                    onClick={() =>
                      void run(
                        () => api.post(`/channels/${c.id}/test`),
                        `Test message sent to ${c.name}.`,
                      )
                    }
                  >
                    Send test
                  </button>
                )}
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() =>
                    void run(() =>
                      api.patch(`/channels/${c.id}`, { enabled: c.state !== "active" }),
                    )
                  }
                >
                  {c.state === "active" ? "Turn off" : "Turn on"}
                </button>
                <button
                  type="button"
                  className="button button-danger button-small"
                  onClick={() => {
                    if (window.confirm(`Delete the ${c.name} channel?`)) {
                      void run(() => api.del(`/channels/${c.id}`));
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

      <form className="form form-inline" onSubmit={(e) => void add(e)}>
        <label>
          Name
          <input name="name" required maxLength={60} placeholder="Team Discord" />
        </label>
        <label className="grow">
          Discord webhook URL
          <input
            name="webhookUrl"
            type="url"
            required
            autoComplete="off"
            placeholder="https://discord.com/api/webhooks/…"
          />
        </label>
        <button className="button" type="submit">
          Add Discord channel
        </button>
      </form>
      <p className="muted small">
        In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.
        Treat the URL like a password.
      </p>
      {message && (
        <p className={message.kind === "error" ? "error" : "success"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
