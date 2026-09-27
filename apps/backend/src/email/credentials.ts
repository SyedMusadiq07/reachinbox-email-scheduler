import "dotenv/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must encode 32 bytes as base64.");
  return key;
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptCredential(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored SMTP credential has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function redactCredentialError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : "SMTP delivery failed.";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.slice(0, 4000);
}
