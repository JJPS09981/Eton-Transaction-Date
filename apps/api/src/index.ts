import { z, ZodError } from "zod";
import { AuthError, createSession, findOrCreateUser, verifyGoogleIdToken, verifySession } from "./auth";
import { parseCommand } from "./contracts";
import type { Env } from "./database";
import { executeCommand, readDashboard, readTransactions, RequestError } from "./service";
import { calendarMonth, historyQuery, readCalendar, readSummary, recentDescriptionQuery, readRecentDescriptions } from "./reports";
import { version } from "../../../package.json";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function budgetToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const allowedOrigin = env.FRONTEND_ORIGIN;
    const cors: HeadersInit = origin === allowedOrigin ? {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "vary": "Origin",
    } : {};
    if (request.method === "OPTIONS") return new Response(null, { status: origin === allowedOrigin ? 204 : 403, headers: cors });
    if (origin && origin !== allowedOrigin) return json({ error: "來源不允許" }, 403);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health" && request.method === "GET") return json({ ok: true, version }, 200, cors);
    try {
      if (path === "/v1/config" && request.method === "GET") {
        return json({ googleClientId: env.GOOGLE_CLIENT_ID ?? "" }, 200, cors);
      }
      if (path === "/v1/auth/google" && request.method === "POST") {
        if (origin !== allowedOrigin) throw new AuthError(403, "來源不允許");
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "需要 JSON 請求");
        if (Number(request.headers.get("content-length") ?? 0) > 12_000) throw new RequestError(413, "請求內容過大");
        const bodyText = await request.text();
        if (bodyText.length > 12_000) throw new RequestError(413, "請求內容過大");
        let raw: unknown;
        try { raw = JSON.parse(bodyText); } catch { throw new RequestError(400, "JSON 格式錯誤"); }
        const { idToken } = z.strictObject({ idToken: z.string().min(100).max(10_000) }).parse(raw);
        if (!env.APP_JWT_SECRET || new TextEncoder().encode(env.APP_JWT_SECRET).length < 32) throw new Error("APP_JWT_SECRET is not configured");
        const profile = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
        const userId = await findOrCreateUser(env, profile);
        const token = await createSession(env, userId);
        return json({ token, userId, user: { id: userId, email: profile.email, name: profile.name } }, 200, cors);
      }
      const session = await verifySession(env, request.headers.get("authorization"));
      if (path === "/v1/auth/session" && request.method === "GET") {
        return json({ userId: session.userId }, 200, cors);
      }
      const userId = session.userId;
      if (path === "/v1/dashboard" && request.method === "GET") {
        return json(await readDashboard(env, userId, budgetToday()), 200, cors);
      }
      if (path === "/v1/transactions" && request.method === "GET") {
        const { cursor, ...filter } = historyQuery.parse(Object.fromEntries(url.searchParams));
        return json(await readTransactions(env, userId, cursor ?? null, filter), 200, cors);
      }
      if (path === "/v1/calendar" && request.method === "GET") {
        return json(await readCalendar(env, userId, calendarMonth.parse(url.searchParams.get("month"))), 200, cors);
      }
      if (path === "/v1/summary" && request.method === "GET") {
        return json(await readSummary(env, userId), 200, cors);
      }
      if (path === "/v1/recent-descriptions" && request.method === "GET") {
        const query = recentDescriptionQuery.parse(Object.fromEntries(url.searchParams));
        return json(await readRecentDescriptions(env,userId,query.category,query.subcategory),200,cors);
      }
      if (path === "/v1/commands" && request.method === "POST") {
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "需要 JSON 請求");
        const bodyText = await request.text();
        if (bodyText.length > 32_768) throw new RequestError(413, "請求內容過大");
        let raw: unknown;
        try { raw = JSON.parse(bodyText); } catch { throw new RequestError(400, "JSON 格式錯誤"); }
        const command = parseCommand(raw);
        return json(await executeCommand(env, userId, command, raw, budgetToday()), 200, cors);
      }
      return json({ error: "找不到 API" }, 404, cors);
    } catch (error) {
      if (error instanceof RequestError || error instanceof AuthError) return json({ error: error.message }, error.status, cors);
      if (error instanceof ZodError) return json({ error: "輸入格式不正確", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400, cors);
      console.error("API request failed", error);
      return json({ error: "伺服器暫時無法處理請求" }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
