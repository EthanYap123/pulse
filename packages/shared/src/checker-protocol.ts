import { z } from "zod";

/**
 * What the API sends the checker about one monitor (POST /internal/v1/monitors/sync).
 * Header values stay encrypted; the checker decrypts them with the shared ENCRYPTION_KEY.
 */
export const checkerMonitorSchema = z.object({
  id: z.uuid(),
  shard: z.number().int().min(0),
  url: z.string(),
  method: z.enum(["GET", "HEAD"]),
  expectedStatus: z.object({ min: z.number().int(), max: z.number().int() }),
  timeoutMs: z.number().int(),
  failureThreshold: z.number().int(),
  encryptedHeaders: z.record(z.string(), z.string()),
  isPaused: z.boolean(),
});
export type CheckerMonitor = z.infer<typeof checkerMonitorSchema>;

export const liveRequestSchema = z.object({
  monitors: z.array(z.object({ id: z.uuid(), shard: z.number().int().min(0) })).max(50),
});

export type LiveStatus = {
  monitorId: string;
  status: "pending" | "up" | "failing" | "down" | "recovering" | "paused";
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
};

// Request signing --------------------------------------------------------------
// HMAC-SHA256 over "timestamp.METHOD.path.body" (docs/API.md). WebCrypto, so the same
// code runs in Node (the API) and Workers (the checker).

export const SIGNATURE_MAX_AGE_SECONDS = 300;

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canonical(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

/** Headers to attach to a request from the API to the checker. */
export async function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  now = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(now / 1000));
  const signature = await hmacHex(secret, canonical(timestamp, method, path, body));
  return { "x-pulse-timestamp": timestamp, "x-pulse-signature": `sha256=${signature}` };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  headers: { timestamp: string | null; signature: string | null },
  now = Date.now(),
): Promise<boolean> {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = `sha256=${await hmacHex(secret, canonical(timestamp, method, path, body))}`;
  return constantTimeEqual(expected, signature);
}
