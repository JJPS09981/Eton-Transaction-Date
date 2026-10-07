import { describe, expect, it } from "vitest";
import { decodeJwt, generateKeyPair, SignJWT } from "jose";
import { AuthError, createSession, verifyGoogleIdToken, verifySession } from "./auth";
import type { Env } from "./database";
import worker from "./index";

const env: Env = {
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  APP_JWT_SECRET: "test-session-signing-secret-longer-than-32-bytes",
  FRONTEND_ORIGIN: "http://127.0.0.1:5173",
};
const userId = "75a585b7-cf24-4d08-b740-bcc861118c53";

describe("Worker session boundary", () => {
  it("checks Google signature, audience, issuer, expiry and verified email", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const googleToken = (audience: string, issuer: string, expires: string, emailVerified = true) =>
      new SignJWT({ email: "person@example.com", email_verified: emailVerified, name: "Test User" })
        .setProtectedHeader({ alg: "RS256" }).setSubject("stable-google-sub")
        .setAudience(audience).setIssuer(issuer).setIssuedAt().setExpirationTime(expires).sign(privateKey);
    const valid = await googleToken(env.GOOGLE_CLIENT_ID, "https://accounts.google.com", "5m");
    expect(await verifyGoogleIdToken(valid, env.GOOGLE_CLIENT_ID, publicKey)).toEqual({
      sub: "stable-google-sub", email: "person@example.com", name: "Test User",
    });
    for (const bad of [
      await googleToken("other-client", "https://accounts.google.com", "5m"),
      await googleToken(env.GOOGLE_CLIENT_ID, "https://other-issuer.example", "5m"),
      await googleToken(env.GOOGLE_CLIENT_ID, "https://accounts.google.com", "-5m"),
      await googleToken(env.GOOGLE_CLIENT_ID, "https://accounts.google.com", "5m", false),
    ]) {
      await expect(verifyGoogleIdToken(bad, env.GOOGLE_CLIENT_ID, publicKey)).rejects.toThrow(AuthError);
    }
  });

  it("accepts only a correctly signed, scoped, unexpired 30-day Bearer token", async () => {
    const token = await createSession(env, userId);
    expect(await verifySession(env, `Bearer ${token}`)).toEqual({ userId });
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(30 * 24 * 60 * 60);
    await expect(verifySession({ ...env, APP_JWT_SECRET: "another-test-secret-with-at-least-32-bytes" }, `Bearer ${token}`)).rejects.toThrow(AuthError);
    await expect(verifySession(env, `Bearer ${token}tampered`)).rejects.toThrow(AuthError);
    await expect(verifySession(env, null)).rejects.toThrow(AuthError);
    await expect(verifySession(env, `budget_session=${token}`)).rejects.toThrow(AuthError);

    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId).setIssuer("dynamic-budget-api").setAudience("dynamic-budget-web")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(env.APP_JWT_SECRET));
    await expect(verifySession(env, `Bearer ${expired}`)).rejects.toThrow(AuthError);
  });

  it("rejects a forged Google credential before opening the database", async () => {
    await expect(verifyGoogleIdToken("not-a-jwt", env.GOOGLE_CLIENT_ID)).rejects.toThrow(AuthError);
    const response = await worker.fetch(new Request("http://127.0.0.1:8787/v1/auth/google", {
      method: "POST",
      headers: { origin: env.FRONTEND_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ idToken: "not-a-jwt".repeat(15) }),
    }), env);
    expect(response.status).toBe(401);
  });

  it("accepts the configured origin's Bearer header and blocks cookies and other origins", async () => {
    const publicResponse = await worker.fetch(new Request("http://127.0.0.1:8787/v1/config", { headers: { origin: env.FRONTEND_ORIGIN } }), env);
    expect(await publicResponse.json()).toEqual({ googleClientId: env.GOOGLE_CLIENT_ID });
    expect(publicResponse.headers.get("access-control-allow-credentials")).toBeNull();
    const preflight = await worker.fetch(new Request("http://127.0.0.1:8787/v1/auth/session", {
      method: "OPTIONS", headers: { origin: env.FRONTEND_ORIGIN, "access-control-request-headers": "authorization" },
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");
    const anonymous = await worker.fetch(new Request("http://127.0.0.1:8787/v1/auth/session"), env);
    expect(anonymous.status).toBe(401);
    const token = await createSession(env, userId);
    const cookieOnly = await worker.fetch(new Request("http://127.0.0.1:8787/v1/auth/session", { headers: { cookie: `budget_session=${token}` } }), env);
    expect(cookieOnly.status).toBe(401);
    const authenticated = await worker.fetch(new Request("http://127.0.0.1:8787/v1/auth/session", {
      headers: { origin: env.FRONTEND_ORIGIN, authorization: `Bearer ${token}` },
    }), env);
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({ userId });
    const otherOrigin = await worker.fetch(new Request("http://127.0.0.1:8787/v1/config", { headers: { origin: "https://attacker.example" } }), env);
    expect(otherOrigin.status).toBe(403);
  });
});
