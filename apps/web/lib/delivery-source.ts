/** Human-facing explanations for stable delivery-source API error codes. */
export function presentDeliverySourceError(error: string): string {
    switch (error) {
        case "delivery_source_unavailable":
            return "No active delivery source is configured for this team. Ask an organization admin to assign a shared ESP, or add a team ESP in Settings.";
        case "delivery_source_required":
            return "Choose a delivery source before sending, or ask an administrator to set this team's default.";
        case "organization_delivery_disabled":
            return "The shared delivery source is no longer active for this team. Ask an organization admin to reactivate or reassign it.";
        case "team_esp_disabled":
            return "Team-owned ESP delivery is disabled for this team. Choose the shared delivery source or ask an organization admin to change the policy.";
        default:
            return error;
    }
}
