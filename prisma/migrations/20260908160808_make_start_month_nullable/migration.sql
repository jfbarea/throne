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
    "startMonth" DATETIME,
    "tiebreakers" TEXT NOT NULL DEFAULT '["POINTS","VP_DIFF","VP_FOR","HEAD_TO_HEAD","LOSSES","ID_ORDER"]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_League" ("bonusEnabled", "bonusMarginThreshold", "bonusMinVP", "createdAt", "id", "matchesPerRound", "name", "playoffSize", "pointsDraw", "pointsLoss", "pointsWin", "season", "startMonth", "status", "tiebreakers", "updatedAt") SELECT "bonusEnabled", "bonusMarginThreshold", "bonusMinVP", "createdAt", "id", "matchesPerRound", "name", "playoffSize", "pointsDraw", "pointsLoss", "pointsWin", "season", "startMonth", "status", "tiebreakers", "updatedAt" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
