import {
    getOAuthTeamSelection,
    listTeamsForUser,
    setOAuthTeamSelection,
} from "../team/queries";

export type SendLitOAuthTeam = {
    id: string;
    publicId: string;
    name: string;
};

export interface SendLitOAuthTeamSelectionAdapter {
    listTeamsForUser(userId: string): Promise<SendLitOAuthTeam[]>;
    getSelectedTeamId(sessionId: string): Promise<string | null>;
    setSelectedTeamId(sessionId: string, teamId: string): Promise<void>;
}

export const oauthTeamSelectionAdapter: SendLitOAuthTeamSelectionAdapter = {
    async listTeamsForUser(userId) {
        const teams = await listTeamsForUser(userId);
        return teams.map((team) => ({
            id: team.id,
            publicId: team.teamId,
            name: team.name,
        }));
    },
    getSelectedTeamId: getOAuthTeamSelection,
    setSelectedTeamId: setOAuthTeamSelection,
};

async function resolveSelection(
    adapter: SendLitOAuthTeamSelectionAdapter,
    userId: string,
    sessionId: string,
) {
    const teams = await adapter.listTeamsForUser(userId);
    if (teams.length <= 1) {
        return { requiresSelection: false, selectedTeamId: null };
    }
    const selectedTeamId = await adapter.getSelectedTeamId(sessionId);
    const valid =
        selectedTeamId !== null &&
        teams.some((team) => team.id === selectedTeamId);
    return {
        requiresSelection: !valid,
        selectedTeamId: valid ? selectedTeamId : null,
    };
}

/** SendLit-owned OAuth team selection and token claim. */
export function createSendLitOAuthTeamSelectionHooks(options: {
    page: string;
    adapter: SendLitOAuthTeamSelectionAdapter;
}) {
    return {
        postLogin: {
            page: options.page,
            async shouldRedirect(input: {
                user: { id: string };
                session: { id: string };
            }) {
                return (
                    await resolveSelection(
                        options.adapter,
                        input.user.id,
                        input.session.id,
                    )
                ).requiresSelection;
            },
            async consentReferenceId(input: {
                user: { id: string };
                session: { id: string };
            }) {
                return (
                    (
                        await resolveSelection(
                            options.adapter,
                            input.user.id,
                            input.session.id,
                        )
                    ).selectedTeamId ?? undefined
                );
            },
        },
        async customAccessTokenClaims(input: { referenceId?: string | null }) {
            return input.referenceId ? { team_id: input.referenceId } : {};
        },
    };
}
