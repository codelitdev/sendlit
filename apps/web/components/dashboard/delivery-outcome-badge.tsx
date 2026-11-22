import type { DeliveryOutcome } from "@sendlit/api-contract";
import { Badge } from "@/components/ui/codelit/badge";

type Variant = "success" | "neutral" | "warning" | "destructive";

/** The words and colour for what happened to one send. Status is always
 * colour plus words, never colour alone. */
export function deliveryOutcomeStyle(
  outcome: DeliveryOutcome,
  bounceType?: "hard" | "soft" | null,
): { label: string; variant: Variant } {
  switch (outcome) {
    case "delivered":
      return { label: "Delivered", variant: "success" };
    case "sent":
      return { label: "Sent", variant: "neutral" };
    case "bounced":
      if (bounceType === "soft") return { label: "Soft bounce", variant: "warning" };
      if (bounceType === "hard")
        return { label: "Hard bounce", variant: "destructive" };
      return { label: "Bounced", variant: "destructive" };
    case "complained":
      return { label: "Spam complaint", variant: "destructive" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
  }
}

export function DeliveryOutcomeBadge({
  outcome,
  bounceType,
}: {
  outcome: DeliveryOutcome;
  bounceType?: "hard" | "soft" | null;
}) {
  const { label, variant } = deliveryOutcomeStyle(outcome, bounceType);
  return <Badge variant={variant}>{label}</Badge>;
}
