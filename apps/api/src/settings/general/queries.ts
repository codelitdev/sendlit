import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { settings } from "../../db/schema";

export type TeamSettings = typeof settings.$inferSelect;

export interface GeneralSettingsInput {
    /** `undefined` = keep unchanged; `""` = clear. */
    mailingAddress?: string;
}

/** The public shape of the per-team general settings singleton. Rows are
 * created lazily on first update — a missing row means "all defaults". */
export interface GeneralSettings {
    mailingAddress: string | null;
    updatedAt: Date | null;
}

function toGeneralSettings(row: TeamSettings | null): GeneralSettings {
    return {
        mailingAddress: row?.mailingAddress ?? null,
        updatedAt: row?.updatedAt ?? null,
    };
}

export async function getTeamSettingsRow(
    teamId: string,
): Promise<TeamSettings | null> {
    const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.teamId, teamId))
        .limit(1);
    return row ?? null;
}

/** Get-or-defaults: never fails on a missing row. */
export async function getGeneralSettings(
    teamId: string,
): Promise<GeneralSettings> {
    return toGeneralSettings(await getTeamSettingsRow(teamId));
}

export async function upsertGeneralSettings(
    teamId: string,
    input: GeneralSettingsInput,
): Promise<GeneralSettings> {
    const existing = await getTeamSettingsRow(teamId);

    const mailingAddress =
        input.mailingAddress === undefined
            ? (existing?.mailingAddress ?? null)
            : input.mailingAddress || null;

    const values = { mailingAddress, updatedAt: new Date() };

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
