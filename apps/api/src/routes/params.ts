import { z } from "zod";
import { notFound } from "../errors.js";

const uuid = z.uuid();

/** Path ids that aren't UUIDs can't exist, so they get the same 404 as anyone else's id. */
export function idParam(params: unknown, name: string): string {
  const value = (params as Record<string, unknown>)[name];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}
