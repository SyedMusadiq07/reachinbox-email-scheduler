ALTER TABLE "campaigns"
ADD COLUMN "idempotencyKey" VARCHAR(255),
ADD COLUMN "requestHash" CHAR(64);

CREATE UNIQUE INDEX "campaigns_userId_idempotencyKey_key"
ON "campaigns"("userId", "idempotencyKey");
