import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shardFor } from "./shard.js";

describe("shardFor", () => {
  it("is stable for the same id", () => {
    const id = "0b9b8f5e-6a51-4b5e-9a0e-3f2d1c4b5a69";
    expect(shardFor(id)).toBe(shardFor(id));
  });

  it("stays within 0..shards-1", () => {
    for (let i = 0; i < 500; i++) {
      const shard = shardFor(randomUUID());
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(5);
    }
  });

  it("spreads ids roughly evenly", () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) counts[shardFor(randomUUID())]! += 1;
    for (const count of counts) {
      expect(count).toBeGreaterThan(800); // expected 1000 each
      expect(count).toBeLessThan(1200);
    }
  });
});
