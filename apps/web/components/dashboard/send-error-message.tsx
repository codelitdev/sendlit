import Link from "next/link";
import { presentDeliverySourceError } from "@/lib/delivery-source";

export const MAILING_ADDRESS_REQUIRED_ERROR =
    "A mailing address is required for broadcasts and sequences.";

/** Maps send-path API errors to a human-facing message, with a Settings
 * link when the mailing address is missing. */
export function SendErrorMessage({ error }: { error: string }) {
    const presented = presentDeliverySourceError(error);
    if (presented === MAILING_ADDRESS_REQUIRED_ERROR) {
        return (
            <>
                A mailing address is required for broadcasts and sequences. Add
                it in{" "}
                <Link
                    href="/settings"
                    className="font-medium underline underline-offset-2"
                >
                    Settings
                </Link>
                .
            </>
        );
    }
    return presented;
}
