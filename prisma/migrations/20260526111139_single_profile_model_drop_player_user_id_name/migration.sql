/*
  Warnings:

  - You are about to drop the column `name` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Player` table. All the data in the column will be lost.
  - Made the column `profileId` on table `Player` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Player" DROP CONSTRAINT "Player_profileId_fkey";

-- DropForeignKey
ALTER TABLE "Player" DROP CONSTRAINT "Player_userId_fkey";

-- AlterTable
ALTER TABLE "Player" DROP COLUMN "name",
DROP COLUMN "userId",
ALTER COLUMN "profileId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
