/**
 * Give an automatically-created team a stable, organization-specific name.
 * Explicit team names still take precedence; this is only for bootstrap and
 * other flows that need a safe default.
 */
export function defaultTeamName(organizationName: string): string {
    const name = organizationName.trim();
    if (!name) return "Default Team";
    if (/\bteam$/i.test(name)) return name;
    return `${name} Team`;
}
