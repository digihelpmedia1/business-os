// Edge-safe session token helpers (used by proxy.ts and server code).
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "dhm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = { uid: string; tv: number };

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload, maxAgeSeconds = SESSION_MAX_AGE) {
  return new SignJWT({ tv: payload.tv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.uid)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .setIssuer("dhm-business-os")
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "dhm-business-os", algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { uid: payload.sub, tv: typeof payload.tv === "number" ? payload.tv : 0 };
  } catch {
    return null;
  }
}
