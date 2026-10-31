import { hash, verify } from "@node-rs/argon2";

// argon2id (the library default) with the OWASP-recommended minimum cost.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the email has no account, so response
 * times don't reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("pulse-dummy-password-for-timing");
  await verify(await dummyHash, password);
  return false;
}
