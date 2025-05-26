/*
  Warnings:

  - You are about to drop the column `firebaseUid` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `isVerified` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `verificationToken` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "users_firebaseUid_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "firebaseUid",
DROP COLUMN "isVerified",
DROP COLUMN "verificationToken";
