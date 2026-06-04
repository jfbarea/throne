// Prisma client singleton — avoids multiple instances in Next.js dev hot-reload
// Prisma 7 requires a Driver Adapter for all connections; for SQLite we use libSQL.
//
// DATABASE_AUTH_TOKEN is only required for remote Turso connections (libsql:// URLs).
// When DATABASE_URL is a local file: URL (dev/test), the token is undefined and the
// adapter behaves identically to before — no network calls, no credentials needed.
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client";

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // authToken is optional: undefined for local file: URLs, required for libsql:// (Turso)
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  const adapter = new PrismaLibSql({ url, authToken });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
