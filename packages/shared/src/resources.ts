import { z } from "zod";
import { DEFAULT_EXPECTED_STATUS, expectedStatusSchema } from "./check.js";
import { LIMITS } from "./limits.js";
import { checkMonitorUrl } from "./url.js";

// Projects ------------------------------------------------------------------

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: "Use 3-40 lowercase letters, numbers or hyphens, not starting or ending with a hyphen",
  });

const projectName = z.string().trim().min(1).max(60);

export const projectInputSchema = z.strictObject({
  name: projectName,
  slug: slugSchema,
  isPublic: z.boolean().default(true),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectPatchSchema = z.strictObject({
  name: projectName.optional(),
  slug: slugSchema.optional(),
  isPublic: z.boolean().optional(),
  statusNote: z.string().trim().max(280).nullable().optional(),
});
export type ProjectPatch = z.infer<typeof projectPatchSchema>;

// Monitors ------------------------------------------------------------------

export const monitorUrlSchema = z.string().transform((raw, ctx) => {
  const result = checkMonitorUrl(raw);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.reason });
    return z.NEVER;
  }
  return result.url;
});

// Headers the checker controls itself, or that would change what the request means.
const RESERVED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "proxy-authorization",
]);

export const monitorHeadersSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/, { message: "Header names may use letters, numbers and -" })
      .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), {
        message: "This header is set by the checker and can't be overridden",
      }),
    z.string().max(1024),
  )
  .refine((h) => Object.keys(h).length <= LIMITS.maxHeadersPerMonitor, {
    message: `At most ${LIMITS.maxHeadersPerMonitor} headers`,
  });

const monitorFields = {
  name: z.string().trim().min(1).max(60),
  url: monitorUrlSchema,
  method: z.enum(["GET", "HEAD"]),
  expectedStatus: expectedStatusSchema,
  timeoutMs: z.number().int().min(1000).max(8000),
  failureThreshold: z.number().int().min(1).max(5),
  headers: monitorHeadersSchema,
  showOnStatusPage: z.boolean(),
};

export const monitorInputSchema = z.strictObject({
  name: monitorFields.name,
  url: monitorFields.url,
  method: monitorFields.method.default("GET"),
  expectedStatus: monitorFields.expectedStatus.default(DEFAULT_EXPECTED_STATUS),
  timeoutMs: monitorFields.timeoutMs.default(8000),
  failureThreshold: monitorFields.failureThreshold.default(3),
  headers: monitorFields.headers.default({}),
  showOnStatusPage: monitorFields.showOnStatusPage.default(true),
});
export type MonitorInput = z.infer<typeof monitorInputSchema>;

/** Every field optional and without defaults, so a PATCH only changes what it sends. */
export const monitorPatchSchema = z.strictObject({
  name: monitorFields.name.optional(),
  url: monitorFields.url.optional(),
  method: monitorFields.method.optional(),
  expectedStatus: monitorFields.expectedStatus.optional(),
  timeoutMs: monitorFields.timeoutMs.optional(),
  failureThreshold: monitorFields.failureThreshold.optional(),
  headers: monitorFields.headers.optional(),
  showOnStatusPage: monitorFields.showOnStatusPage.optional(),
});
export type MonitorPatch = z.infer<typeof monitorPatchSchema>;
