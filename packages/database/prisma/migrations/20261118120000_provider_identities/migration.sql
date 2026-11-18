-- CreateTable
CREATE TABLE "provider_identities" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_identities_provider_providerAccountId_key" ON "provider_identities"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "provider_identities_userId_idx" ON "provider_identities"("userId");

-- AddForeignKey
ALTER TABLE "provider_identities" ADD CONSTRAINT "provider_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backfill existing OAuth users into provider_identities
INSERT INTO "provider_identities" ("id", "userId", "provider", "providerAccountId", "email", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), "userId", "provider", "providerId", "email", "createdAt", CURRENT_TIMESTAMP
FROM "users"
WHERE "provider" IS NOT NULL AND "providerId" IS NOT NULL
ON CONFLICT DO NOTHING;
