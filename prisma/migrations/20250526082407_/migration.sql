-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationToken" TEXT;
