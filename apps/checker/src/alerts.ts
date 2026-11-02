import {
  classifyDiscordResponse,
  discordPayload,
  type AlertMessage,
  type SendOutcome,
} from "@pulse/shared";
import type { CheckDeps } from "./run-checks.js";

/** Posts one alert to a Discord webhook and says what to do next. Never throws. */
export async function sendDiscord(
  fetch: CheckDeps["fetch"],
  webhookUrl: string,
  message: AlertMessage,
): Promise<SendOutcome> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(discordPayload(message)),
      signal: AbortSignal.timeout(5000),
    });
    const retryAfter = res.headers.get("retry-after");
    await res.body?.cancel();
    return classifyDiscordResponse(res.status, retryAfter);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "retry", afterMs: null, error: `could not reach Discord: ${reason}` };
  }
}
