import { describe, expect, it } from "vitest";
import { field } from "./forms.js";

describe("field", () => {
  it("returns text values and an empty string for missing or file fields", () => {
    const form = new FormData();
    form.set("email", "a@example.com");
    form.set("upload", new Blob(["x"]), "x.txt");
    expect(field(form, "email")).toBe("a@example.com");
    expect(field(form, "upload")).toBe("");
    expect(field(form, "missing")).toBe("");
  });
});
