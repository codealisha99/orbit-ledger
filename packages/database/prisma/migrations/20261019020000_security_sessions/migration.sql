-- Revoke legacy stateless tokens at application verification; preserve all financial data.
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users("userId") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "auth_sessions_userId_createdAt_idx" ON auth_sessions("userId", "createdAt");
CREATE INDEX "auth_sessions_expiresAt_idx" ON auth_sessions("expiresAt");
ALTER TABLE "LoginCode" ADD COLUMN challenge TEXT;
