import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { connect, type Env } from "./database";

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_ISSUER = "dynamic-budget-api";
const SESSION_AUDIENCE = "dynamic-budget-web";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

export class AuthError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface GoogleProfile {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface SessionIdentity {
  userId: string;
}

function sessionKey(env: Env): Uint8Array {
  if (!env.APP_JWT_SECRET || new TextEncoder().encode(env.APP_JWT_SECRET).length < 32) {
    throw new Error("APP_JWT_SECRET must have at least 32 bytes");
  }
  return new TextEncoder().encode(env.APP_JWT_SECRET);
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  keyResolver: Parameters<typeof jwtVerify>[1] = GOOGLE_KEYS,
): Promise<GoogleProfile> {
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  try {
    const { payload } = await jwtVerify(idToken, keyResolver, {
      audience: clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      algorithms: ["RS256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub || payload.email_verified !== true) {
      throw new Error("Google identity is incomplete");
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch {
    throw new AuthError(401, "Google 登入驗證失敗");
  }
}

export async function findOrCreateUser(env: Env, profile: GoogleProfile): Promise<string> {
  const db = await connect(env);
  try {
    const result = await db.query(`
      insert into public.app_users (id, google_sub, email, display_name, last_login_at)
      values ($1, $2, $3, $4, now())
      on conflict (google_sub) do update
      set email = excluded.email, display_name = excluded.display_name, last_login_at = now()
      returning id
    `, [crypto.randomUUID(), profile.sub, profile.email, profile.name]);
    return result.rows[0].id as string;
  } finally {
    await db.end();
  }
}

export async function createSession(env: Env, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(sessionKey(env));
}

export async function verifySession(env: Env, authorizationHeader: string | null): Promise<SessionIdentity> {
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : null;
  if (!token) throw new AuthError(401, "需要登入");
  const key = sessionKey(env);
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!payload.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
      throw new Error("Invalid session subject");
    }
    return { userId: payload.sub };
  } catch {
    throw new AuthError(401, "登入已失效，請重新登入");
  }
}
