import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const webOrigin = "https://td.etontw.com";
const apiOrigin = "https://api.td.etontw.com";
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
const digest = (data) => createHash("sha256").update(data).digest("hex");

try {
  const [page, manifest, health, preflight, anonymous] = await Promise.all([
    request(`${webOrigin}/?release=${version}`),
    request(`${webOrigin}/version.json?release=${version}`),
    request(`${apiOrigin}/health`),
    request(`${apiOrigin}/v1/commands`, { method: "OPTIONS", headers: {
      origin: webOrigin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type",
    } }),
    request(`${apiOrigin}/v1/summary`),
  ]);
  ensure(page.status === 200 && manifest.status === 200 && health.status === 200, "正式站讀取失敗");
  const [html, webVersion, apiHealth] = await Promise.all([page.text(), manifest.json(), health.json()]);
  ensure(webVersion.version === version && apiHealth.version === version && apiHealth.ok, "前端與 API 版本不一致");
  ensure(html.includes(`name="app-version" content="${version}"`), "HTML 版本與建置不一致");
  ensure(page.headers.get("content-security-policy")?.includes(apiOrigin), "正式前端 CSP 未包含 API");
  ensure(preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === webOrigin, "正式 CORS 預檢失敗");
  ensure(anonymous.status === 401, "匿名摘要請求未拒絕");
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
  ensure(assets.some((asset) => asset.endsWith(".js")) && assets.some((asset) => asset.endsWith(".css")), "HTML 缺少主要建置資產");
  await Promise.all(assets.map(async (asset) => {
    const response = await request(webOrigin + asset);
    ensure(response.status === 200, `正式資產讀取失敗：${asset}`);
    const [remote, local] = await Promise.all([
      response.arrayBuffer(), readFile(new URL("../apps/web/dist" + asset, import.meta.url)),
    ]);
    ensure(digest(Buffer.from(remote)) === digest(local), `正式資產與本次建置不符：${asset}`);
  }));
  console.log(JSON.stringify({ version, web: 200, api: 200, assetsMatch: true, cors: 204, anonymousSummary: 401 }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "正式版本檢查失敗");
  process.exitCode = 1;
}
