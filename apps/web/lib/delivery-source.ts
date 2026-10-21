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
    case "content_held_for_review":
      return "This email is being reviewed by SendLit before it can be sent. We've emailed you; you can send it once it's approved, usually within a business day.";
    case "content_blocked":
      return "This email looks like it could harm recipients, so sending for this team is paused while SendLit reviews it. Reply to our email if you think this is a mistake.";
    case "import_under_review":
      return "Your recent contact import is being reviewed by SendLit. Campaigns can start once it's approved, usually within a business day.";
    case "organization_sending_suspended":
      return "Sending is suspended for this organization. Contact SendLit support.";
    case "team_sending_suspended":
      return "Sending is suspended for this team. Ask an organization admin to resume it.";
    case "sending_paused":
      return "Sending is paused for this team. This happens when a payment is overdue, when bounce or complaint rates get too high, or while SendLit reviews the account. Check the Plan tab on your organization page, or contact SendLit support if it stays paused.";
    case "delivery_source_in_use":
      return "This ESP can't be removed while it is used by an active sequence, queued email, or delivery integration.";
    default:
      return error;
  }
}

export function isDeletedDeliverySource({
  report,
  status,
  deliverySource,
}: {
  report: unknown;
  status: string;
  deliverySource: unknown;
}): boolean {
  return (
    (typeof report === "object" &&
      report !== null &&
      !Array.isArray(report) &&
      (report as Record<string, unknown>).deliverySourceDeleted === true) ||
    (status === "completed" && deliverySource === null)
  );
}
