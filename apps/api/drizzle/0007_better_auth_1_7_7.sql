-- Better Auth 1.7.7: account.issuer is no longer written (keep existing values;
-- a later release drops the column), and access tokens record revocation.
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD COLUMN "revoked" timestamp with time zone;