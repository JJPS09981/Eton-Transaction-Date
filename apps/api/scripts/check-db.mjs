import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const lines = readFileSync(resolve(projectDir, ".dev.vars"), "utf8").split(/\r?\n/);
    const line = lines.find((entry) => entry.startsWith("DATABASE_URL="));
    const value = line?.slice("DATABASE_URL=".length).trim();
    if (!value) return undefined;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  } catch {
    return undefined;
  }
}

const raw = connectionString();
if (!raw) {
  console.log("DB_CHECK=MISSING_URL");
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.log("DB_CHECK=INVALID_URL");
  process.exit(1);
}

if (!url.hostname.endsWith(".pooler.supabase.com") || url.port !== "5432" || !url.username.startsWith("postgres.")) {
  console.log("DB_CHECK=EXPECTED_SESSION_POOLER");
  process.exit(1);
}

let client;
try {
  client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 12_000 });
  await client.connect();
  await client.query("select 1");
  console.log("DB_CHECK=CONNECTED");
} catch (error) {
  console.log(`DB_CHECK=FAILED_${typeof error.code === "string" ? error.code : "UNKNOWN"}`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
