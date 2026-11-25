import type { PostalAddress } from "@sendlit/api-contract";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { settings } from "../../db/schema";
import { mailingAddressText, normalizePostalAddress } from "./address";
import { MAILING_ADDRESS_REQUIRED } from "./constants";

export { mailingAddressText, normalizePostalAddress } from "./address";
export { MAILING_ADDRESS_REQUIRED, POSTAL_COUNTRY_INVALID } from "./constants";

export type TeamSettings = typeof settings.$inferSelect;

export interface GeneralSettingsInput {
  /** `undefined` = keep unchanged; `null` = clear. */
  postalAddress?: PostalAddress | null;
}

/** The public shape of the per-team general settings singleton. Rows are
 * created lazily on first update — a missing row means "all defaults". */
export interface GeneralSettings {
  postalAddress: PostalAddress | null;
  updatedAt: Date | null;
}

/** A physical mailing address is required for marketing campaign delivery. */
export async function assertMailingAddressConfigured(teamId: string): Promise<void> {
  const { postalAddress } = await getGeneralSettings(teamId);
  if (!mailingAddressText(postalAddress)) {
    throw new Error(MAILING_ADDRESS_REQUIRED);
  }
}

function toGeneralSettings(row: TeamSettings | null): GeneralSettings {
  return {
    postalAddress: row?.postalAddress ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function getTeamSettingsRow(teamId: string): Promise<TeamSettings | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.teamId, teamId))
    .limit(1);
  return row ?? null;
}

/** Get-or-defaults: never fails on a missing row. */
export async function getGeneralSettings(teamId: string): Promise<GeneralSettings> {
  return toGeneralSettings(await getTeamSettingsRow(teamId));
}

export async function upsertGeneralSettings(
  teamId: string,
  input: GeneralSettingsInput,
): Promise<GeneralSettings> {
  const postalAddress =
    input.postalAddress === undefined
      ? undefined
      : input.postalAddress && normalizePostalAddress(input.postalAddress);
  const existing = await getTeamSettingsRow(teamId);

  const values = {
    postalAddress:
      postalAddress === undefined ? (existing?.postalAddress ?? null) : postalAddress,
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(settings)
      .set(values)
      .where(eq(settings.teamId, teamId))
      .returning();
    return toGeneralSettings(row);
  }

  const [row] = await db
    .insert(settings)
    .values({ teamId, ...values })
    .returning();
  return toGeneralSettings(row);
}
