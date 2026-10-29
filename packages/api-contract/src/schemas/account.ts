import { z } from "zod";
import { organizationRoleSchema } from "./organizations";

export const accountDeletionBlockerSchema = z.enum([
  "active_subscription_exists",
  "billing_checkout_pending",
  "last_organization_owner",
  "billing_manager_required",
]);

/** What deleting the account does to one organization the person is in. */
export const accountDeletionOrganizationSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  status: z.enum(["pending_payment", "active", "suspended", "abandoned", "closed"]),
  role: organizationRoleSchema,
  /** `delete`: they are its last owner, so it is deleted with its contacts'
   * data. `leave`: someone else stays in charge; only their membership goes. */
  action: z.enum(["delete", "leave"]),
  teamCount: z.number().int(),
  /** What has to happen before the account can be deleted, if anything. */
  blocker: accountDeletionBlockerSchema.nullable(),
});

export const accountDeletionPreviewSchema = z.object({
  email: z.string(),
  organizations: z.array(accountDeletionOrganizationSchema),
  blocked: z.boolean(),
});

export const deleteAccountBodySchema = z.object({
  /** The account's email, typed to confirm. */
  email: z.string().trim().min(1),
  /** The code sent by `POST /account/deletion/code`. */
  code: z.string().trim().min(1),
});

export const accountDeletionBlockedSchema = accountDeletionPreviewSchema
  .omit({ email: true })
  .extend({ error: z.literal("account_deletion_blocked") });
