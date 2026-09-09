// Run a command against PRODUCTION, loading .env.prod into its environment.
//
// The default for everything in this repo is local: `.env` holds the local
// SQLite database and is what `next dev`, the tests and the Prisma scripts
// pick up on their own. Production credentials live in `.env.prod`, which
// nothing loads automatically — you get them only by asking for them through
// one of the `:prod` scripts in package.json, which all go through here.
//
// That asymmetry is the point: forgetting the flag leaves you in local, never
// pointed at the live league by accident.
//
// Usage (via package.json, not directly):
//   npm run dev:prod
//   npm run seed:prod
//   npm run studio:prod
//
// This works because Next does not overwrite variables already present in
// process.env: whatever .env.prod sets here wins over the repo's .env.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const ENV_FILE = ".env.prod";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("ERROR: nothing to run. Usage: node scripts/with-prod-env.mjs <cmd> [args...]");
  process.exit(1);
}

const envPath = resolve(process.cwd(), ENV_FILE);
if (!existsSync(envPath)) {
  console.error(
    `ERROR: ${ENV_FILE} not found.\n\n` +
      "Production credentials are kept out of .env on purpose. Create it with\n" +
      "the Turso URL and token (see docs/configuracion.md); it is gitignored.",
  );
  process.exit(1);
}

// Minimal dotenv parse: KEY=VALUE per line, optional quotes, # comments.
// Deliberately not a dependency — this file must not be able to fail on an
// install issue when it is the thing standing between you and production.
const parsed = {};
for (const raw of readFileSync(envPath, "utf8").split("\n")) {
  const line = raw.trim();
  if (line.length === 0 || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  parsed[key] = value;
}

const url = parsed.DATABASE_URL;
if (!url) {
  console.error(`ERROR: ${ENV_FILE} has no DATABASE_URL.`);
  process.exit(1);
}
if (!url.startsWith("libsql://")) {
  // If this file does not point at Turso it is not the production env, and
  // running "the prod script" against something else is worse than failing.
  console.error(
    `ERROR: ${ENV_FILE} does not point at Turso (DATABASE_URL = ${url}).\n` +
      "Expected a libsql:// URL. Refusing to run: a :prod script that silently\n" +
      "targets something else is exactly the mistake this wrapper exists to stop.",
  );
  process.exit(1);
}
if (!parsed.DATABASE_AUTH_TOKEN) {
  console.error(`ERROR: ${ENV_FILE} has no DATABASE_AUTH_TOKEN.`);
  process.exit(1);
}

const host = url.replace("libsql://", "").split(".")[0];
console.error(
  `\n[43m[30m  PRODUCCIÓN  [0m  ${command.join(" ")} → ${host}\n` +
    `  Lo que escribas aquí lo ve la liga. Ctrl+C para salir.\n`,
);

// Local binaries first, so `next` / `tsx` / `prisma` resolve without npx.
const env = {
  ...process.env,
  ...parsed,
  PATH: `${join(process.cwd(), "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
};

const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });

child.on("error", (err) => {
  console.error(`ERROR: could not run "${command[0]}": ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
