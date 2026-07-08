import { Router, Request, Response } from "express";
import { db } from "../db/client";
import { emailEvents } from "../db/schema";
import { verifyPixelToken } from "../utils/pixel-jwt";
import {
    getContactByContactId,
    getContactByUnsubscribeToken,
    updateContact,
} from "../contacts/queries";
import { getSequenceEmailByEmailId } from "../sequences/queries";
import { getSequenceRowBySequenceId } from "../automation/queries";
import { EmailEventAction } from "../config/constants";
import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";

const router = Router();

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
    "base64",
);

interface TeamScopedEvent {
    contactId: string;
    sequenceId: string;
    emailId: string;
    index?: number;
    link?: string;
}

// Open-tracking pixel embedded in outgoing mail.
router.get("/track/open", async (req: Request, res: Response) => {
    const token = String(req.query.d || "");
    const payload = verifyPixelToken<TeamScopedEvent>(token);

    res.set("Content-Type", "image/gif");
    res.send(TRANSPARENT_GIF);

    if (!payload) return;
    try {
        const resolved = await resolveEventIds(payload);
        if (!resolved) return;
        await db.insert(emailEvents).values({
            teamId: resolved.teamId,
            sequenceId: resolved.sequenceId,
            contactId: resolved.contactId,
            emailId: resolved.emailId,
            action: EmailEventAction.OPEN,
        });
        captureEvent({
            event: "email_opened",
            source: "tracking.open",
            teamId: resolved.teamId,
            properties: {
                sequence_id: resolved.sequenceId,
                email_id: resolved.emailId,
            },
        });
    } catch (err: any) {
        logger.error({ error: err.message }, "Failed to record open event");
        captureError({
            error: err,
            source: "tracking.open",
            context: { route: "/track/open" },
        });
    }
});

// Click-tracking redirect embedded in outgoing mail links.
router.get("/track/click", async (req: Request, res: Response) => {
    const token = String(req.query.d || "");
    const payload = verifyPixelToken<TeamScopedEvent>(token);
    if (!payload || !payload.link) {
        return res.status(400).send("Invalid tracking link");
    }

    const destination = decodeURIComponent(payload.link);

    try {
        const resolved = await resolveEventIds(payload);
        if (resolved) {
            await db.insert(emailEvents).values({
                teamId: resolved.teamId,
                sequenceId: resolved.sequenceId,
                contactId: resolved.contactId,
                emailId: resolved.emailId,
                action: EmailEventAction.CLICK,
                link: destination,
                linkIndex: payload.index,
            });
            captureEvent({
                event: "email_link_clicked",
                source: "tracking.click",
                teamId: resolved.teamId,
                properties: {
                    sequence_id: resolved.sequenceId,
                    email_id: resolved.emailId,
                    link_index: payload.index,
                },
            });
        }
    } catch (err: any) {
        logger.error({ error: err.message }, "Failed to record click event");
        captureError({
            error: err,
            source: "tracking.click",
            context: { route: "/track/click" },
        });
    }

    res.redirect(destination);
});

// Unsubscribe a contact via their unsubscribe link.
router.get(
    "/unsubscribe/:unsubscribeToken",
    async (req: Request, res: Response) => {
        const contact = await getContactByUnsubscribeToken(
            req.params.unsubscribeToken,
        );
        if (!contact) return res.status(404).send("Invalid unsubscribe link");

        await updateContact(contact.teamId, contact.contactId, {
            subscribed: false,
        });
        captureEvent({
            event: "contact_unsubscribed",
            source: "tracking.unsubscribe",
            teamId: contact.teamId,
        });

        res.type("html").send(
            "<!DOCTYPE html><html><body>You have been unsubscribed.</body></html>",
        );
    },
);

/** Resolves the public ids decoded from a tracking JWT into the internal ids
 * `email_events` now requires as FKs. Fails soft (returns `null`) if the
 * contact/sequence/email was deleted since send — the caller already treats
 * that the same way a DB error would be treated (log and move on, never 500
 * a tracking pixel/redirect request). */
async function resolveEventIds(payload: TeamScopedEvent): Promise<{
    teamId: string;
    sequenceId: string;
    contactId: string;
    emailId: string;
} | null> {
    const contact = await getContactByContactId(payload.contactId);
    if (!contact) return null;

    const sequence = await getSequenceRowBySequenceId(
        contact.teamId,
        payload.sequenceId,
    );
    if (!sequence) return null;

    const email = await getSequenceEmailByEmailId(sequence.id, payload.emailId);
    if (!email) return null;

    return {
        teamId: contact.teamId,
        sequenceId: sequence.id,
        contactId: contact.id,
        emailId: email.id,
    };
}

export default router;
