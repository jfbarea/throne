/*
  Warnings:

  - You are about to drop the column `matchId` on the `BracketSlot` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BracketSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bracketId" TEXT NOT NULL,
    "roundIndex" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "playerId" TEXT,
    "feedsIntoSlotId" TEXT,
    CONSTRAINT "BracketSlot_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BracketSlot_feedsIntoSlotId_fkey" FOREIGN KEY ("feedsIntoSlotId") REFERENCES "BracketSlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BracketSlot" ("bracketId", "feedsIntoSlotId", "id", "playerId", "position", "roundIndex") SELECT "bracketId", "feedsIntoSlotId", "id", "playerId", "position", "roundIndex" FROM "BracketSlot";
DROP TABLE "BracketSlot";
ALTER TABLE "new_BracketSlot" RENAME TO "BracketSlot";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
