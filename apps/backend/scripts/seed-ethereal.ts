import "dotenv/config";
import nodemailer from "nodemailer";
import { prisma } from "../src/db/prisma.js";
import { encryptCredential } from "../src/email/credentials.js";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Ethereal seed is development-only.");
  const user = await prisma.user.upsert({
    where: { googleId: "local-development-only" },
    update: {},
    create: { googleId: "local-development-only", name: "Local Development", email: "local-dev@reachinbox.test" },
  });
  const senders = await prisma.sender.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const knownEmails = new Set(senders.map((sender) => sender.email.toLowerCase()));
  let attempts = 0;
  for (let index = senders.length; index < 2;) {
    if (attempts++ >= 12) throw new Error("Could not create two distinct Ethereal sender accounts after 12 attempts.");
    const account = await nodemailer.createTestAccount();
    if (knownEmails.has(account.user.toLowerCase())) continue;
    try {
      await prisma.sender.create({
        data: {
          userId: user.id,
          email: account.user,
          displayName: `Ethereal Sender ${index + 1}`,
          smtpHost: account.smtp.host,
          smtpPort: account.smtp.port,
          smtpUsernameEncrypted: encryptCredential(account.user),
          smtpPasswordEncrypted: encryptCredential(account.pass),
        },
      });
      knownEmails.add(account.user.toLowerCase());
      index += 1;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      knownEmails.add(account.user.toLowerCase());
    }
  }
  const result = await prisma.sender.findMany({ where: { userId: user.id, active: true }, select: { id: true } });
  console.info(`Development user ready with ${result.length} sender(s).`);
  for (const sender of result) console.info(sender.id);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Ethereal seed failed.");
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
