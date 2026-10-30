import { describe, expect, it } from "vitest";
import worker from "./index.js";

describe("checker fetch handler", () => {
  it("answers /health", async () => {
    const res = worker.fetch(new Request("https://checker.test/health"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", environment: "local" });
  });

  it("returns 404 for anything else", () => {
    const res = worker.fetch(new Request("https://checker.test/nope"), {});
    expect(res.status).toBe(404);
  });
});
