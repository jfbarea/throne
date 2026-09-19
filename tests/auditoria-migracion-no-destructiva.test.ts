// Tests for Z2 (auditoria-de-continuidad, multi-liga cierre).
// Demuestra el criterio 47 de la spec / criterio 4 del hito ("Ninguna acción
// de la migración borra o reescribe filas existentes: solo añade columnas y
// las rellena") en lugar de darlo por bueno porque lo diga un comentario.
//
// No pasa por Prisma ni por el cliente generado: ese cliente ya tiene el
// esquema POST-migración (slug/archivedAt/rulesMarkdown existen), así que no
// hay forma de construir con él una fila `League` "de antes" y aplicarle
// después la migración de verdad — cualquier test que lo intentara estaría
// asumiendo el propio resultado que debería probar. En su lugar:
//
//   1. Se crea una base SQLite nueva y se le aplican, con el mismo binario
//      `sqlite3` que usaría `prisma migrate deploy`, los ficheros
//      `migration.sql` reales de las cinco migraciones anteriores — el
//      esquema exacto que tiene hoy producción.
//   2. Se puebla con datos representativos en cada tabla del dominio
//      (League, Player, Round, Match, Result, Bracket, BracketSlot,
//      AuditLog), con un nombre de liga que lleva tildes y "ñ" para forzar
//      el plegado de acentos que hace la migración en SQL puro.
//   3. Se vuelca el contenido íntegro de todas las tablas.
//   4. Se aplica la migración bajo prueba
//      (20260911140227_add_league_slug_archived_rules) con el mismo binario.
//   5. Se vuelve a volcar todo y se compara byte a byte contra el volcado
//      previo.
//
// Vive fuera de `tests/**/*.test.ts` de Vitest normal solo en el sentido de
// que no toca `file:./test.db` (usa su propio fichero temporal, aislado y
// borrado al final) — no interfiere con el resto de la suite ni con
// `db-global-setup.ts`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { slugify } from "@/server/slug";
import { DEFAULT_RULES_MARKDOWN } from "@/server/league/default-rules";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "prisma", "migrations");

// Todas las migraciones anteriores a la que se audita, en orden — el mismo
// esquema que tiene hoy producción antes del deploy de multi-liga.
const PRE_EXISTING_MIGRATIONS = [
  "20260604120554_init",
  "20260604123748_modelo_datos_dominio",
  "20260604125058_remove_bracketslot_matchid",
  "20260908154638_add_rounds_and_resolution",
  "20260908160808_make_start_month_nullable",
];
const MIGRATION_UNDER_TEST = "20260911140227_add_league_slug_archived_rules";

const DB_PATH = join(
  os.tmpdir(),
  `throne-auditoria-migracion-${process.pid}-${Date.now()}.db`
);

function runSql(sql: string): void {
  execFileSync("sqlite3", [DB_PATH], {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runSqlFile(path: string): void {
  runSql(readFileSync(path, "utf8"));
}

function queryJson<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync("sqlite3", ["-json", DB_PATH, sql], {
    encoding: "utf8",
  });
  const trimmed = out.trim();
  return trimmed ? (JSON.parse(trimmed) as T[]) : [];
}

// Tablas que la migración bajo prueba NO toca — deben salir bit a bit
// idénticas. `League` se compara aparte porque SÍ gana columnas.
const UNTOUCHED_TABLES = [
  "Player",
  "Round",
  "Match",
  "Result",
  "Bracket",
  "BracketSlot",
  "AuditLog",
];

function dumpUntouchedTables(): Record<string, unknown[]> {
  const dump: Record<string, unknown[]> = {};
  for (const table of UNTOUCHED_TABLES) {
    dump[table] = queryJson(`SELECT * FROM "${table}" ORDER BY "id";`);
  }
  return dump;
}

const LEAGUE_NAME = "Liga de Auditoría Peña Ñu";
const LEAGUE_SEASON = "2026 Otoño";

describe("Migración add_league_slug_archived_rules — no destructiva (spec §6.1, criterio 47)", () => {
  let before: Record<string, unknown[]>;
  let leagueBefore: Record<string, unknown>;

  beforeAll(() => {
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

    for (const migration of PRE_EXISTING_MIGRATIONS) {
      runSqlFile(join(MIGRATIONS_DIR, migration, "migration.sql"));
    }

    // Fixture: una fila en cada tabla del dominio, tocando cada relación FK
    // del esquema (League -> Player -> Round -> Match -> Result,
    // League -> Bracket -> BracketSlot, Player -> AuditLog).
    runSql(`
      INSERT INTO "League" (id, name, season, status, pointsWin, pointsDraw, pointsLoss, bonusEnabled, bonusMarginThreshold, bonusMinVP, playoffSize, matchesPerRound, startMonth, tiebreakers, createdAt, updatedAt)
      VALUES ('league-1', '${LEAGUE_NAME}', '${LEAGUE_SEASON}', 'LEAGUE', 3, 1, 0, 1, 20, 40, 4, 2, '2026-01-01 00:00:00', '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

      INSERT INTO "Player" (id, leagueId, displayName, faction, role, passcodeHash, active, createdAt, updatedAt) VALUES
        ('player-admin', 'league-1', 'Admin', 'Agentes del Imperio', 'ADMIN', 'hash-admin', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
        ('player-1', 'league-1', 'Jugador Uno', 'Ultramarines', 'PLAYER', 'hash-1', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
        ('player-2', 'league-1', 'Jugador Dos', 'Orkos', 'PLAYER', 'hash-2', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

      INSERT INTO "Round" (id, leagueId, "index", deadline, closedAt) VALUES
        ('round-1', 'league-1', 1, '2026-01-31 00:00:00', NULL);

      INSERT INTO "Match" (id, leagueId, phase, status, roundId, playerHomeId, playerAwayId, scheduledAt, location, isBye, bracketSlotId, createdAt, updatedAt) VALUES
        ('match-1', 'league-1', 'LEAGUE', 'CONFIRMED', 'round-1', 'player-1', 'player-2', '2026-01-15 18:00:00', 'Casa de Uno', 0, NULL, '2026-01-01 00:00:00', '2026-01-16 00:00:00');

      INSERT INTO "Result" (id, matchId, homeVictoryPoints, awayVictoryPoints, outcome, resolution, reportedById, confirmedById, reportedAt, confirmedAt, bonusHome, bonusAway) VALUES
        ('result-1', 'match-1', 60, 40, 'HOME_WIN', 'PLAYED', 'player-1', 'player-2', '2026-01-15 20:00:00', '2026-01-16 00:00:00', 1, 0);

      INSERT INTO "Bracket" (id, leagueId, size, createdAt) VALUES
        ('bracket-1', 'league-1', 4, '2026-01-01 00:00:00');

      INSERT INTO "BracketSlot" (id, bracketId, roundIndex, position, playerId, feedsIntoSlotId) VALUES
        ('slot-1', 'bracket-1', 1, 1, 'player-1', NULL),
        ('slot-2', 'bracket-1', 1, 2, 'player-2', NULL);

      INSERT INTO "AuditLog" (id, actorId, action, entityType, entityId, payload, createdAt) VALUES
        ('audit-1', 'player-admin', 'REPORT_RESULT', 'Match', 'match-1', '{"note":"fixture"}', '2026-01-15 20:00:00');
    `);

    before = dumpUntouchedTables();
    leagueBefore = queryJson(`SELECT * FROM "League" WHERE id = 'league-1';`)[0];
    expect(leagueBefore).toBeDefined();

    runSqlFile(join(MIGRATIONS_DIR, MIGRATION_UNDER_TEST, "migration.sql"));
  });

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const p = `${DB_PATH}${suffix}`;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("no toca ni una fila de Player, Round, Match, Result, Bracket, BracketSlot ni AuditLog", () => {
    const after = dumpUntouchedTables();
    expect(after).toEqual(before);
  });

  it("no borra ni cambia ninguna columna preexistente de League: mismo id, mismos valores", () => {
    const rows = queryJson(`SELECT * FROM "League";`);
    expect(rows).toHaveLength(1); // ni se duplicó ni se borró la única liga

    const after = rows[0] as Record<string, unknown>;
    for (const key of Object.keys(leagueBefore)) {
      expect(after[key]).toEqual(leagueBefore[key]);
    }
  });

  it("rellena slug (no vacío, kebab-case, único) y deja archivedAt a null", () => {
    const after = queryJson(`SELECT * FROM "League";`)[0] as Record<
      string,
      unknown
    >;
    expect(typeof after.slug).toBe("string");
    expect(after.slug as string).not.toBe("");
    expect(after.slug as string).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(after.archivedAt).toBeNull();
  });

  it("el slug de backfill en SQL coincide con slugify(name, season) para un nombre con tildes y ñ", () => {
    // La migración no puede llamar a src/server/slug.ts (es SQL puro,
    // ejecutado por el motor de la base, no por Node) y aproxima el mismo
    // resultado a mano (ver el comentario de cabecera del propio
    // migration.sql). Esta prueba es la que demuestra que la aproximación
    // no ha divergido de la función real para un nombre representativo,
    // en vez de asumirlo.
    const after = queryJson(`SELECT * FROM "League";`)[0] as Record<
      string,
      unknown
    >;
    const expected = slugify(LEAGUE_NAME, LEAGUE_SEASON);
    expect(after.slug).toBe(expected);
  });

  it("rellena rulesMarkdown con la plantilla por defecto, byte a byte", () => {
    const after = queryJson(`SELECT * FROM "League";`)[0] as Record<
      string,
      unknown
    >;
    expect(after.rulesMarkdown).toBe(DEFAULT_RULES_MARKDOWN);
  });

  it("no deja ninguna violación de integridad referencial tras la migración", () => {
    const violations = queryJson(`PRAGMA foreign_key_check;`);
    expect(violations).toEqual([]);
  });
});
