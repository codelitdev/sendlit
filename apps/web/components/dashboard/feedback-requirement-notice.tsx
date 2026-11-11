import { Banner } from "@/components/dashboard/banner";
import type { FeedbackRequirement } from "@/lib/api";

/** Explains SendLit Cloud's rule that each ESP needs bounce and complaint
 * feedback once the organization has sent its first emails, with how close
 * it is. Owners are also emailed at 50%, 90% and 100% (see the API's
 * delivery-feedback/feedback-requirement.ts). Renders nothing when the rule
 * doesn't apply. */
export function FeedbackRequirementNotice({
  requirement,
  newEsp = false,
  className,
}: {
  requirement: FeedbackRequirement | null | undefined;
  /** Shown while creating an ESP, before feedback can be set up for it. */
  newEsp?: boolean;
  className?: string;
}) {
  if (!requirement?.required) return null;
  const { requiredAfterSends: limit, sentSoFar: sent } = requirement;
  const reached = sent >= limit;
  const progress = reached
    ? `Your organization has sent ${sent} emails, so this applies now.`
    : `Your organization has sent ${sent} of them so far.`;
  return (
    <Banner
      variant={reached ? "error" : sent * 2 >= limit ? "warning" : "info"}
      className={className}
    >
      After your organization&apos;s first {limit} emails, SendLit only sends through
      providers that report bounces and spam complaints back, to protect your sender
      reputation. {progress}{" "}
      {newEsp
        ? "Once you've saved this ESP, set up its delivery feedback from the ESP list."
        : "Set up delivery feedback for each ESP with its feedback button below."}
    </Banner>
  );
}
