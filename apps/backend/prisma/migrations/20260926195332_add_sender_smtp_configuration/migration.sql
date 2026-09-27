/*
  Warnings:

  - You are about to drop the column `credentialRef` on the `senders` table. All the data in the column will be lost.
  - Added the required column `smtpHost` to the `senders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `smtpPasswordEncrypted` to the `senders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `smtpPort` to the `senders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `smtpUsernameEncrypted` to the `senders` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "senders" DROP COLUMN "credentialRef",
ADD COLUMN     "smtpHost" TEXT NOT NULL,
ADD COLUMN     "smtpPasswordEncrypted" TEXT NOT NULL,
ADD COLUMN     "smtpPort" INTEGER NOT NULL,
ADD COLUMN     "smtpUsernameEncrypted" TEXT NOT NULL;
