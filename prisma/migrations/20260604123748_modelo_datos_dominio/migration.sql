/*
  Warnings:

  - You are about to drop the `Placeholder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Placeholder";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "League" (
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
    "tiebreakers" TEXT NOT NULL DEFAULT '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "faction" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "passcodeHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Player_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'LEAGUE',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "playerHomeId" TEXT NOT NULL,
    "playerAwayId" TEXT,
    "scheduledAt" DATETIME,
    "location" TEXT,
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "bracketSlotId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Match_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_playerHomeId_fkey" FOREIGN KEY ("playerHomeId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_playerAwayId_fkey" FOREIGN KEY ("playerAwayId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Match_bracketSlotId_fkey" FOREIGN KEY ("bracketSlotId") REFERENCES "BracketSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "homeVictoryPoints" INTEGER NOT NULL,
    "awayVictoryPoints" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "Bracket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bracket_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BracketSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bracketId" TEXT NOT NULL,
    "roundIndex" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "playerId" TEXT,
    "matchId" TEXT,
    "feedsIntoSlotId" TEXT,
    CONSTRAINT "BracketSlot_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BracketSlot_feedsIntoSlotId_fkey" FOREIGN KEY ("feedsIntoSlotId") REFERENCES "BracketSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Result_matchId_key" ON "Result"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Bracket_leagueId_key" ON "Bracket"("leagueId");
