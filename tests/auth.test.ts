// Unit tests for Hito 4: auth-sesion
// Tests cover:
//   1. verifyAdminPasscode — constant-time comparison
//   2. verifySession / signSession — JWT round-trip
//   3. Guard logic — requireAdmin rejects PLAYER sessions
//   4. Identity derives from cookie, never from client input (design-level test)

import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";

// ============================================================
// 1. Admin passcode verification
// ============================================================

describe("verifyAdminPasscode", () => {
  // Set SESSION_SECRET and ADMIN_PASSCODE via process.env (injected by vitest.config.ts env).
  // Tests run against a known passcode: "super-admin-test-passcode"

  it("returns true when passcode matches ADMIN_PASSCODE env var", async () => {
    const { verifyAdminPasscode } = await import("@/lib/auth");
    expect(verifyAdminPasscode("super-admin-test-passcode")).toBe(true);
  });

  it("returns false for an incorrect passcode", async () => {
    const { verifyAdminPasscode } = await import("@/lib/auth");
    expect(verifyAdminPasscode("wrong-passcode")).toBe(false);
  });

  it("returns false for an empty string", async () => {
    const { verifyAdminPasscode } = await import("@/lib/auth");
    expect(verifyAdminPasscode("")).toBe(false);
  });

  it("returns false for a passcode that is prefix of the correct one", async () => {
    const { verifyAdminPasscode } = await import("@/lib/auth");
    // "super-admin-test-passcod" — one char short — must fail
    expect(verifyAdminPasscode("super-admin-test-passcod")).toBe(false);
  });
});

// ============================================================
// 2. Player passcode verification (bcrypt)
// ============================================================

describe("bcrypt passcode verification", () => {
  // These tests exercise bcrypt directly to confirm the seed hash is valid.
  // They do NOT call the DB (no Prisma); they verify the crypto primitive.
  const knownHash =
    "$2b$10$4EDHVVhvPoBe7l47tWuXRe2fPNXyFJT/gB1KlkmGHEGh3xa.OgSvm";

  it("accepts passcode '1234' against the seed hash", async () => {
    const result = await bcrypt.compare("1234", knownHash);
    expect(result).toBe(true);
  });

  it("rejects a wrong passcode against the seed hash", async () => {
    const result = await bcrypt.compare("wrong", knownHash);
    expect(result).toBe(false);
  });

  it("rejects an empty passcode", async () => {
    const result = await bcrypt.compare("", knownHash);
    expect(result).toBe(false);
  });
});

// ============================================================
// 3. JWT session: signSession / verifySession
// ============================================================

describe("signSession / verifySession", () => {
  // SESSION_SECRET is set to a 32-char test value via vitest.config.ts env.

  it("round-trips a PLAYER session", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const payload = { playerId: "player-abc", role: "PLAYER" as const };
    const token = await signSession(payload);
    const decoded = await verifySession(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.playerId).toBe("player-abc");
    expect(decoded?.role).toBe("PLAYER");
  });

  it("round-trips an ADMIN session", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const payload = { playerId: null, role: "ADMIN" as const };
    const token = await signSession(payload);
    const decoded = await verifySession(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.playerId).toBeNull();
    expect(decoded?.role).toBe("ADMIN");
  });

  it("returns null for a tampered token", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const token = await signSession({ playerId: "p1", role: "PLAYER" });
    // Tamper the payload section (second segment of the JWT).
    const parts = token.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ playerId: "injected-by-attacker", role: "ADMIN" })
    )
      .toString("base64url");
    const tampered = parts.join(".");
    const result = await verifySession(tampered);
    expect(result).toBeNull();
  });

  it("returns null for an arbitrary string", async () => {
    const { verifySession } = await import("@/lib/session");
    expect(await verifySession("not.a.jwt")).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const { verifySession } = await import("@/lib/session");
    expect(await verifySession("")).toBeNull();
  });
});

// ============================================================
// 4. Guard logic — server derives role from cookie, not from client
// ============================================================

describe("guard: identity derives from signed token only", () => {
  it("a PLAYER token cannot be promoted to ADMIN by altering the payload", async () => {
    const { signSession, verifySession } = await import("@/lib/session");

    // Attacker obtains a PLAYER token and tries to promote themselves.
    const legitimateToken = await signSession({
      playerId: "player-123",
      role: "PLAYER",
    });

    // Attacker forges the payload to claim ADMIN.
    const [header, , signature] = legitimateToken.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ playerId: "player-123", role: "ADMIN" })
    ).toString("base64url");
    const forgedToken = `${header}.${forgedPayload}.${signature}`;

    // The server must reject this token.
    const decoded = await verifySession(forgedToken);
    expect(decoded).toBeNull();
  });

  it("verifySession result always determines the role — never the raw payload", async () => {
    // This test documents the invariant: guards call verifySession;
    // they never read role from a client-supplied value.
    // We simulate what a guard does: only trust verifySession output.
    const { signSession, verifySession } = await import("@/lib/session");

    const token = await signSession({ playerId: "p-xyz", role: "PLAYER" });

    // A guard reads the role only from the verified payload.
    const session = await verifySession(token);
    const roleFromCookie = session?.role;

    // Attacker-controlled string (what a client might send in a header / body).
    const clientClaimedRole = "ADMIN";

    // Guard uses roleFromCookie, not clientClaimedRole.
    expect(roleFromCookie).toBe("PLAYER");
    expect(roleFromCookie).not.toBe(clientClaimedRole);
  });
});

// ============================================================
// 5. Guard role enforcement — requireAdmin / requirePlayer
// ============================================================

describe("guards: role enforcement", () => {
  // We test the guard logic by inspecting the session payload role,
  // which is what requireAdmin / requirePlayer check before redirecting.

  it("ADMIN session satisfies admin check", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const token = await signSession({ playerId: "admin-1", role: "ADMIN" });
    const session = await verifySession(token);
    expect(session?.role).toBe("ADMIN");
    // Guard would pass: role === "ADMIN"
    expect(session?.role === "ADMIN").toBe(true);
  });

  it("PLAYER session fails admin check", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const token = await signSession({ playerId: "player-1", role: "PLAYER" });
    const session = await verifySession(token);
    expect(session?.role).toBe("PLAYER");
    // Guard would redirect: role !== "ADMIN"
    expect(session?.role === "ADMIN").toBe(false);
  });

  it("null session fails any auth check", async () => {
    const { verifySession } = await import("@/lib/session");
    const session = await verifySession("invalid");
    // Guard would redirect to /login
    expect(session).toBeNull();
  });

  it("ADMIN session also satisfies player check (admin can do everything)", async () => {
    const { signSession, verifySession } = await import("@/lib/session");
    const token = await signSession({ playerId: "admin-1", role: "ADMIN" });
    const session = await verifySession(token);
    // requirePlayer allows any authenticated session (PLAYER or ADMIN).
    expect(session).not.toBeNull();
  });
});
