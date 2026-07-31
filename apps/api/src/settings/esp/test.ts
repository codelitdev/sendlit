import { sendTestMail } from "../../mail/send";
import { getEmailFrom } from "../../utils/mail";
import { captureError, captureEvent } from "../../observability/posthog";
import {
    decryptEspCredentials,
    recordEspTestResult,
    type EspConfig,
} from "./queries";
import { MAILING_ADDRESS_REQUIRED } from "../general/constants";

export interface TestEspConfigResult {
    success: boolean;
    error?: string;
    /** Set when no destination address could be resolved at all — distinct
     * from a delivery failure so callers (REST `400` vs `502`, MCP) can tell
     * "nothing to send to" apart from "the ESP rejected the send". */
    noDestination?: boolean;
    /** Set when the team has not configured its required physical address. */
    mailingAddressRequired?: boolean;
}

/** Sends a real test email through `config`'s transport and records the
 * result — the shared core of the REST `/settings/esp(s)/test` routes and
 * the `test_esp`/`send_test_email` MCP tools, so the send + record-result +
 * observability logic lives in exactly one place. */
export async function testEspConfig({
    config,
    to,
    account,
    source,
}: {
    config: EspConfig;
    to?: string;
    account: { name?: string | null; email?: string | null } | null;
    source: string;
}): Promise<TestEspConfigResult> {
    const destination = to || account?.email;
    if (!destination) {
        return {
            success: false,
            error: "No destination email address available.",
            noDestination: true,
        };
    }

    const from = getEmailFrom({
        name: config.fromName || account?.name || "SendLit",
        email: config.fromEmail || "",
    });

    try {
        if (config.ownerScope === "organization") {
            const credentials = decryptEspCredentials(config);
            const transport = createTransport({
                host: credentials.host,
                port: credentials.port,
                secure: credentials.secure,
                auth: credentials.username
                    ? {
                          user: credentials.username,
                          pass: credentials.password || "",
                      }
                    : undefined,
            });
            await transport.sendMail({
                from,
                to: destination,
                subject: "SendLit test email",
                html: "<p>This is a test email from your SendLit ESP configuration. If you're reading this, it works!</p>",
            });
            transport.close();
        } else {
            await sendTestMail({
                from,
                to: destination,
                subject: "SendLit test email",
                html: "<p>This is a test email from your SendLit ESP configuration. If you're reading this, it works!</p>",
                teamId: config.teamId!,
                espConfigId: config.id,
            });
        }
        await recordEspTestResult(
            config.ownerScope === "organization"
                ? config.organizationId!
                : config.teamId!,
            "success",
            undefined,
            config.espId,
            config.ownerScope as "organization" | "team",
        );
        captureEvent({
            event: "esp_test_succeeded",
            source,
            teamId: config.teamId,
            properties: { esp_id: config.espId, provider: config.provider },
        });
        return { success: true };
    } catch (err: any) {
        if (err.message === MAILING_ADDRESS_REQUIRED) {
            return {
                success: false,
                error: "A mailing address is required before sending email.",
                mailingAddressRequired: true,
            };
        }
        await recordEspTestResult(
            config.ownerScope === "organization"
                ? config.organizationId!
                : config.teamId!,
            "failed",
            err.message,
            config.espId,
            config.ownerScope as "organization" | "team",
        );
        captureError({
            error: err,
            source,
            teamId: config.teamId,
            severity: "warning",
            context: { esp_id: config.espId, provider: config.provider },
        });
        return { success: false, error: err.message };
    }
}
import { createTransport } from "nodemailer";
