import type { PostalAddress } from "@sendlit/api-contract";
import {
  formatPostalAddress,
  isPostalCountryCode,
} from "@sendlit/email-blocks/postal-address";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { settings } from "../../db/schema";
import {
  MAILING_ADDRESS_REQUIRED,
  POSTAL_ADDRESS_CONFLICT,
  POSTAL_COUNTRY_INVALID,
} from "./constants";

export {
  MAILING_ADDRESS_REQUIRED,
  POSTAL_ADDRESS_CONFLICT,
  POSTAL_COUNTRY_INVALID,
} from "./constants";

export type TeamSettings = typeof settings.$inferSelect;

export interface GeneralSettingsInput {
  /** Free text. `undefined` = keep unchanged; `""` = clear. Clears
   * `postalAddress`. */
  mailingAddress?: string;
  /** Separate fields; `mailingAddress` becomes their formatted text.
   * `undefined` = keep unchanged; `null` = clear the address. */
  postalAddress?: PostalAddress | null;
}

/** The public shape of the per-team general settings singleton. Rows are
 * created lazily on first update — a missing row means "all defaults". */
export interface GeneralSettings {
  mailingAddress: string | null;
  postalAddress: PostalAddress | null;
  updatedAt: Date | null;
}

/** A physical mailing address is required for marketing campaign delivery. */
export async function assertMailingAddressConfigured(teamId: string): Promise<void> {
  const settings = await getGeneralSettings(teamId);
  if (!settings.mailingAddress?.trim()) {
    throw new Error(MAILING_ADDRESS_REQUIRED);
  }
}

function toGeneralSettings(row: TeamSettings | null): GeneralSettings {
  return {
    mailingAddress: row?.mailingAddress ?? null,
    postalAddress: row?.postalAddress ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Drops blank optional fields so a stored address only has what was set. */
function normalizePostalAddress(address: PostalAddress): PostalAddress {
  const optional = (value?: string) => value?.trim() || undefined;
  const normalized: PostalAddress = {
    line1: address.line1.trim(),
    country: address.country,
  };
  for (const key of ["line2", "city", "region", "postalCode"] as const) {
    const value = optional(address[key]);
    if (value) normalized[key] = value;
  }
  return normalized;
}

/**
 * The address columns an update writes, or `undefined` when it leaves the
 * address alone. Throws `POSTAL_ADDRESS_CONFLICT` when both forms are sent
 * and `POSTAL_COUNTRY_INVALID` for a country that isn't a current ISO
 * 3166-1 alpha-2 code.
 */
export function resolveAddressUpdate(
  input: GeneralSettingsInput,
): { mailingAddress: string | null; postalAddress: PostalAddress | null } | undefined {
  if (input.mailingAddress !== undefined && input.postalAddress !== undefined) {
    throw new Error(POSTAL_ADDRESS_CONFLICT);
  }
  if (input.postalAddress === null) {
    return { mailingAddress: null, postalAddress: null };
  }
  if (input.postalAddress) {
    if (!isPostalCountryCode(input.postalAddress.country)) {
      throw new Error(POSTAL_COUNTRY_INVALID);
    }
    const postalAddress = normalizePostalAddress(input.postalAddress);
    return { mailingAddress: formatPostalAddress(postalAddress), postalAddress };
  }
  if (input.mailingAddress !== undefined) {
    return { mailingAddress: input.mailingAddress || null, postalAddress: null };
  }
  return undefined;
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
  const address = resolveAddressUpdate(input);
  const existing = await getTeamSettingsRow(teamId);

  const values = {
    mailingAddress: address
      ? address.mailingAddress
      : (existing?.mailingAddress ?? null),
    postalAddress: address ? address.postalAddress : (existing?.postalAddress ?? null),
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
