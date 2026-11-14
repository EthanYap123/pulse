import type { LookupHost } from "../../src/resolve.js";

/** Hostnames the integration tests use to reach the blocked-address paths. */
export const PRIVATE_HOST = "private.pulse-test.example";
export const MISSING_HOST = "missing.pulse-test.example";

/** Fake DNS so tests don't depend on the network: everything else resolves to a public IP. */
export const fakeLookup: LookupHost = (hostname) => {
  if (hostname === PRIVATE_HOST) return Promise.resolve(["93.184.215.14", "10.0.0.5"]);
  if (hostname === MISSING_HOST) {
    return Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
  }
  return Promise.resolve(["93.184.215.14"]);
};
