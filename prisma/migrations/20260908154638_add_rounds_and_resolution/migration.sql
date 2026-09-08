-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "deadline" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Round_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETUP',
    "pointsWin" INTEGER NOT NULL DEFAULT 3,
    "pointsDraw" INTEGER NOT NULL DEFAULT 1,
    "pointsLoss" INTEGER NOT NULL DEFAULT 0,
    "bonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bonusMarginThreshold" INTEGER,
    "bonusMinVP" INTEGER,
    "playoffSize" INTEGER NOT NULL DEFAULT 4,
    "matchesPerRound" INTEGER NOT NULL DEFAULT 2,
    "startMonth" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tiebreakers" TEXT NOT NULL DEFAULT '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_League" ("bonusEnabled", "bonusMarginThreshold", "bonusMinVP", "createdAt", "id", "name", "playoffSize", "pointsDraw", "pointsLoss", "pointsWin", "season", "status", "tiebreakers", "updatedAt") SELECT "bonusEnabled", "bonusMarginThreshold", "bonusMinVP", "createdAt", "id", "name", "playoffSize", "pointsDraw", "pointsLoss", "pointsWin", "season", "status", "tiebreakers", "updatedAt" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE TABLE "new_Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'LEAGUE',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "roundId" TEXT,
    "playerHomeId" TEXT NOT NULL,
    "playerAwayId" TEXT,
    "scheduledAt" DATETIME,
    "location" TEXT,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "bracketSlotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Match_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_playerHomeId_fkey" FOREIGN KEY ("playerHomeId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_playerAwayId_fkey" FOREIGN KEY ("playerAwayId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_bracketSlotId_fkey" FOREIGN KEY ("bracketSlotId") REFERENCES "BracketSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Match" ("bracketSlotId", "createdAt", "id", "isBye", "leagueId", "location", "phase", "playerAwayId", "playerHomeId", "scheduledAt", "status", "updatedAt") SELECT "bracketSlotId", "createdAt", "id", "isBye", "leagueId", "location", "phase", "playerAwayId", "playerHomeId", "scheduledAt", "status", "updatedAt" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE TABLE "new_Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "homeVictoryPoints" INTEGER NOT NULL,
    "awayVictoryPoints" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PLAYED',
    "reportedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "bonusHome" INTEGER NOT NULL DEFAULT 0,
    "bonusAway" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Result_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Result_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Result" ("awayVictoryPoints", "bonusAway", "bonusHome", "confirmedAt", "confirmedById", "homeVictoryPoints", "id", "matchId", "outcome", "reportedAt", "reportedById") SELECT "awayVictoryPoints", "bonusAway", "bonusHome", "confirmedAt", "confirmedById", "homeVictoryPoints", "id", "matchId", "outcome", "reportedAt", "reportedById" FROM "Result";
DROP TABLE "Result";
ALTER TABLE "new_Result" RENAME TO "Result";
CREATE UNIQUE INDEX "Result_matchId_key" ON "Result"("matchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Round_leagueId_index_key" ON "Round"("leagueId", "index");
