import type { DeliverySourceSelection, SendingOption } from "@/lib/api";

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
    case "broadcast_held_for_review":
      return "Your first large broadcast is being reviewed by SendLit, a one-time check for new accounts. We've emailed you; start it again once it's approved, usually within a business day.";
    case "import_under_review":
      return "Your recent contact import is being reviewed by SendLit, a one-time check for new accounts. Campaigns can start once it's approved, usually within a business day, with no further review of your first broadcast.";
    case "organization_sending_suspended":
      return "Sending is suspended for this organization. Contact SendLit support.";
    case "team_sending_suspended":
      return "Sending is suspended for this team. Ask an organization admin to resume it.";
    case "sending_paused":
      return "Sending is paused for this team. This happens when a payment is overdue, when bounce or complaint rates get too high, or while SendLit reviews the account. Check the Plan tab on your organization page, or contact SendLit support if it stays paused.";
    case "organization_team_quota_exhausted":
      return "Your team has used its shared-mailbox quota for now. Ask an organization admin to raise it, or wait for it to reset.";
    case "organization_quota_exhausted":
      return "The organization's shared mailbox has reached its sending quota for now. Ask an organization admin to raise it, or wait for it to reset.";
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

/** "Name (from@address)", prefixed "Shared:" for the organization's sender. */
export function sendingOptionLabel(option: SendingOption): string {
  const sender = option.fromEmail ? ` (${option.fromEmail})` : "";
  return option.type === "organization"
    ? `Shared: ${option.name}${sender}`
    : `${option.name}${sender}`;
}

/** The delivery source a send will use for `selection`: the one chosen, else
 * the team default, else the only one available. Null when it can't be told
 * (nothing available, or a choice that's no longer available). */
export function sendingOptionFor(
  options: SendingOption[],
  selection: DeliverySourceSelection | null | undefined,
): SendingOption | null {
  const available = options.filter((option) => option.available);
  if (selection?.type === "organization") {
    return available.find((option) => option.type === "organization") ?? null;
  }
  if (selection?.type === "team") {
    return (
      available.find(
        (option) => option.type === "team" && option.espId === selection.espId,
      ) ?? null
    );
  }
  return (
    available.find((option) => option.isDefault) ??
    (available.length === 1 ? (available[0] ?? null) : null)
  );
}
