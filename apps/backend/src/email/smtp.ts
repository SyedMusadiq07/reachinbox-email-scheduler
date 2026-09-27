import nodemailer from "nodemailer";
import type { Sender } from "../generated/prisma/client.js";
import { decryptCredential, redactCredentialError } from "./credentials.js";

export async function sendWithSender(sender: Sender, recipient: string, subject: string, body: string) {
  const username = decryptCredential(sender.smtpUsernameEncrypted);
  const password = decryptCredential(sender.smtpPasswordEncrypted);
  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: { user: username, pass: password },
  });
  try {
    const info = await transporter.sendMail({
      from: sender.displayName ? { name: sender.displayName, address: sender.email } : sender.email,
      to: recipient,
      subject,
      text: body,
    });
    return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) ?? undefined };
  } catch (error) {
    throw new Error(redactCredentialError(error, [username, password]));
  } finally {
    transporter.close();
  }
}
