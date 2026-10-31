import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "pulse-api";
const AUDIENCE = "pulse-web";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function signAccessToken(userId: string, secret: string, now = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(key(secret));
}

/** Returns the user id, or null if the token is invalid or expired. */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now = new Date(),
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** SHA-256 digest, in the byte type Prisma uses for `Bytes` columns. */
export type TokenHash = Uint8Array<ArrayBuffer>;

/** A new opaque refresh token. Only its hash is stored. */
export function newRefreshToken(): { token: string; hash: TokenHash } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): TokenHash {
  return new Uint8Array(createHash("sha256").update(token).digest());
}
