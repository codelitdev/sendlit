import {
    defaultEmail,
    type Email as EmailContent,
} from "@sendlit/email-editor";
import { createFooterEmailBlock } from "@sendlit/email-blocks/footer";
import type {
    TemplatePurpose,
    TemplateVariableDefinition,
} from "@sendlit/api-contract";
import { getRequiredTemplateVariables } from "./validation";

export interface SystemTemplate {
    templateId: string;
    title: string;
    description: string;
    purpose: TemplatePurpose;
    content: EmailContent;
    requiredVariables: string[];
    variableDefinitions?: TemplateVariableDefinition[];
}

/**
 * Built-in starting points offered alongside a team's own saved templates
 * when creating a template, broadcast, sequence, or adding an email to a
 * sequence — ported from CourseLit's `templates/system-emails/*.json` +
 * `getSystemEmailTemplates` (`apps/web/graphql/mails/logic.ts`). Unlike
 * CourseLit these are static, in-code data rather than files read off disk at
 * request time, since they never change per-deployment; `resolveStartingTemplate`
 * in `templates/queries.ts` checks these before falling back to the DB, so a
 * broadcast or sequence can be seeded from a marketing starter. Transactional
 * starters must first be duplicated into a team-owned `tpl_` template.
 */
const MARKETING_SYSTEM_TEMPLATES: Array<
    Omit<SystemTemplate, "purpose" | "requiredVariables">
> = [
    {
        templateId: "system:announcement",
        title: "Announcement",
        description:
            "A polished announcement template for launches, updates, and key news.",
        content: {
            style: {
                colors: {
                    background: "#fdf2f8",
                    foreground: "#111827",
                    border: "#fbcfe8",
                    accent: "#db2777",
                    accentForeground: "#ffffff",
                },
                typography: {
                    header: {
                        fontFamily: "Helvetica, sans-serif",
                        letterSpacing: "-0.4px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    text: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    link: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "14px",
                        lineHeight: "1.5",
                        letterSpacing: "0.3px",
                        textTransform: "uppercase",
                        textDecoration: "none",
                    },
                },
                interactives: {
                    button: {
                        padding: { x: "22px", y: "12px" },
                        border: {
                            width: "0px",
                            radius: "999px",
                            style: "solid",
                        },
                    },
                    link: { padding: { x: "0px", y: "0px" } },
                },
                structure: {
                    page: {
                        background: "#ffffff",
                        foreground: "#111827",
                        width: "640px",
                        marginY: "24px",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderRadius: "24px",
                    },
                    section: { padding: { x: "32px", y: "20px" } },
                },
            },
            meta: {
                previewText:
                    "A polished announcement template for launches, updates, and key news.",
            },
            content: [
                {
                    blockType: "text",
                    settings: {
                        content: "JUST ANNOUNCED",
                        alignment: "center",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "12px",
                        foregroundColor: "#db2777",
                        paddingTop: "6px",
                        paddingBottom: "4px",
                    },
                },
                {
                    blockType: "image",
                    settings: {
                        src: "https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&dpr=2&w=1200",
                        alt: "Team collaborating in an office",
                        alignment: "center",
                        width: "100%",
                        maxWidth: "100%",
                        paddingTop: "8px",
                        paddingBottom: "12px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content: "# Make your next announcement feel premium",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "26px",
                        foregroundColor: "#111827",
                        paddingTop: "8px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "This layout is designed for launches, waitlist openings, seasonal updates, and event drops where the headline and CTA need to carry the message clearly.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "17px",
                        lineHeight: "1.7",
                        foregroundColor: "#475569",
                        paddingTop: "0px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "link",
                    settings: {
                        text: "Claim your spot",
                        url: "#",
                        alignment: "left",
                        isButton: true,
                        buttonColor: "#db2777",
                        buttonTextColor: "#ffffff",
                        buttonBorderRadius: "999px",
                        buttonPaddingX: "22px",
                        buttonPaddingY: "12px",
                        buttonBorderWidth: "0px",
                        buttonBorderStyle: "solid",
                        buttonBorderColor: "#db2777",
                        paddingTop: "6px",
                        paddingBottom: "16px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#fbcfe8",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "0px",
                        paddingBottom: "14px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "## Why this template works\n\n- Fast visual hierarchy.\n- Clean body copy.\n- Strong CTA treatment.\n- Enough polish to feel current without being overdesigned.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        foregroundColor: "#111827",
                        paddingTop: "0px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#fce7f3",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "18px",
                        paddingBottom: "10px",
                    },
                },
                createFooterEmailBlock({
                    fontFamily: "Helvetica, sans-serif",
                    paddingTop: "0px",
                    paddingBottom: "0px",
                }),
            ],
        },
    },
    {
        templateId: "system:welcome",
        title: "New user welcome",
        description:
            "A friendly welcome email for onboarding new users and subscribers.",
        content: {
            style: {
                colors: {
                    background: "#f8fafc",
                    foreground: "#111827",
                    border: "#dbe4ee",
                    accent: "#2563eb",
                    accentForeground: "#ffffff",
                },
                typography: {
                    header: {
                        fontFamily: "Helvetica, sans-serif",
                        letterSpacing: "-0.2px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    text: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    link: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "14px",
                        lineHeight: "1.5",
                        letterSpacing: "0.2px",
                        textTransform: "uppercase",
                        textDecoration: "none",
                    },
                },
                interactives: {
                    button: {
                        padding: { x: "22px", y: "12px" },
                        border: {
                            width: "0px",
                            radius: "999px",
                            style: "solid",
                        },
                    },
                    link: { padding: { x: "0px", y: "0px" } },
                },
                structure: {
                    page: {
                        background: "#ffffff",
                        foreground: "#111827",
                        width: "640px",
                        marginY: "24px",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderRadius: "20px",
                    },
                    section: { padding: { x: "32px", y: "18px" } },
                },
            },
            meta: {
                previewText:
                    "A friendly welcome email for onboarding new users and subscribers.",
            },
            content: [
                {
                    blockType: "text",
                    settings: {
                        content: "WELCOME",
                        alignment: "center",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "12px",
                        foregroundColor: "#2563eb",
                        paddingTop: "8px",
                        paddingBottom: "0px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content: "# Welcome aboard",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "26px",
                        foregroundColor: "#111827",
                        paddingTop: "6px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "Thanks for joining us. This template works well for onboarding, first-touch education, getting-started checklists, and setting expectations for what comes next.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "17px",
                        lineHeight: "1.7",
                        foregroundColor: "#475569",
                        paddingTop: "0px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "link",
                    settings: {
                        text: "Get started",
                        url: "#",
                        alignment: "left",
                        isButton: true,
                        buttonColor: "#2563eb",
                        buttonTextColor: "#ffffff",
                        buttonBorderRadius: "999px",
                        buttonPaddingX: "22px",
                        buttonPaddingY: "12px",
                        buttonBorderWidth: "0px",
                        buttonBorderStyle: "solid",
                        buttonBorderColor: "#2563eb",
                        paddingTop: "6px",
                        paddingBottom: "16px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "## What to do next\n\n- Complete your profile or setup.\n- Explore your dashboard or core feature.\n- Save this email for quick access later.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        foregroundColor: "#111827",
                        paddingTop: "0px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#dbe4ee",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "12px",
                        paddingBottom: "10px",
                    },
                },
                createFooterEmailBlock({
                    fontFamily: "Helvetica, sans-serif",
                    paddingTop: "0px",
                    paddingBottom: "0px",
                }),
            ],
        },
    },
    {
        templateId: "system:upsell",
        title: "Upsell products",
        description:
            "A polished upsell email to spotlight related products and premium offers.",
        content: {
            style: {
                colors: {
                    background: "#f8fafc",
                    foreground: "#0f172a",
                    border: "#dbe4ee",
                    accent: "#7c3aed",
                    accentForeground: "#ffffff",
                },
                typography: {
                    header: {
                        fontFamily: "Helvetica, sans-serif",
                        letterSpacing: "-0.3px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    text: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    link: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "14px",
                        lineHeight: "1.5",
                        letterSpacing: "0.3px",
                        textTransform: "uppercase",
                        textDecoration: "none",
                    },
                },
                interactives: {
                    button: {
                        padding: { x: "22px", y: "12px" },
                        border: {
                            width: "0px",
                            radius: "999px",
                            style: "solid",
                        },
                    },
                    link: { padding: { x: "0px", y: "0px" } },
                },
                structure: {
                    page: {
                        background: "#ffffff",
                        foreground: "#0f172a",
                        width: "640px",
                        marginY: "24px",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderRadius: "20px",
                    },
                    section: { padding: { x: "32px", y: "18px" } },
                },
            },
            meta: {
                previewText:
                    "A polished upsell email to spotlight related products and premium offers.",
            },
            content: [
                {
                    blockType: "text",
                    settings: {
                        content: "RECOMMENDED FOR YOU",
                        alignment: "center",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "12px",
                        foregroundColor: "#7c3aed",
                        backgroundColor: "#f5f3ff",
                        paddingTop: "8px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "# Products your customers are ready to buy next",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "26px",
                        foregroundColor: "#0f172a",
                        paddingTop: "8px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "Use this for upgrades, bundles, complementary offers, limited-time incentives, and premium add-ons that naturally follow an initial purchase.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "17px",
                        lineHeight: "1.7",
                        foregroundColor: "#475569",
                        paddingTop: "0px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "link",
                    settings: {
                        text: "View recommended products",
                        url: "#",
                        alignment: "left",
                        isButton: true,
                        buttonColor: "#7c3aed",
                        buttonTextColor: "#ffffff",
                        buttonBorderRadius: "999px",
                        buttonPaddingX: "22px",
                        buttonPaddingY: "12px",
                        buttonBorderWidth: "0px",
                        buttonBorderStyle: "solid",
                        buttonBorderColor: "#7c3aed",
                        paddingTop: "6px",
                        paddingBottom: "16px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "## Why this converts\n\n- Relevant add-on recommendation.\n- Clear next step.\n- A premium but simple visual treatment.\n- Plenty of room for benefits, pricing, or testimonials.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        foregroundColor: "#0f172a",
                        paddingTop: "0px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#e9d5ff",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "18px",
                        paddingBottom: "10px",
                    },
                },
                createFooterEmailBlock({
                    fontFamily: "Helvetica, sans-serif",
                    paddingTop: "0px",
                    paddingBottom: "0px",
                }),
            ],
        },
    },
    {
        templateId: "system:newsletter",
        title: "Newsletter",
        description:
            "A clean, editorial newsletter for recurring updates and curated stories.",
        content: {
            style: {
                colors: {
                    background: "#f8fafc",
                    foreground: "#0f172a",
                    border: "#dbe4ee",
                    accent: "#0f766e",
                    accentForeground: "#ffffff",
                },
                typography: {
                    header: {
                        fontFamily: "Arial, sans-serif",
                        letterSpacing: "-0.2px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    text: {
                        fontFamily: "Arial, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    link: {
                        fontFamily: "Arial, sans-serif",
                        fontSize: "14px",
                        lineHeight: "1.5",
                        letterSpacing: "0.2px",
                        textTransform: "uppercase",
                        textDecoration: "none",
                    },
                },
                interactives: {
                    button: {
                        padding: { x: "20px", y: "11px" },
                        border: { width: "0px", radius: "8px", style: "solid" },
                    },
                    link: { padding: { x: "0px", y: "0px" } },
                },
                structure: {
                    page: {
                        background: "#ffffff",
                        foreground: "#0f172a",
                        width: "640px",
                        marginY: "24px",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderRadius: "20px",
                    },
                    section: { padding: { x: "32px", y: "18px" } },
                },
            },
            meta: {
                previewText:
                    "A clean, editorial newsletter for recurring updates and curated stories.",
            },
            content: [
                {
                    blockType: "text",
                    settings: {
                        content: "WEEKLY NEWSLETTER",
                        alignment: "left",
                        fontFamily: "Arial, sans-serif",
                        fontSize: "12px",
                        foregroundColor: "#0f766e",
                        paddingTop: "6px",
                        paddingBottom: "0px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content: "# What happened this week",
                        alignment: "left",
                        fontFamily: "Arial, sans-serif",
                        fontSize: "26px",
                        foregroundColor: "#0f172a",
                        paddingTop: "10px",
                        paddingBottom: "10px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "Use this for curated updates, editorial roundups, key announcements, and useful links your audience will want to save.",
                        alignment: "left",
                        fontFamily: "Arial, sans-serif",
                        fontSize: "17px",
                        lineHeight: "1.7",
                        foregroundColor: "#475569",
                        paddingTop: "0px",
                        paddingBottom: "14px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#dbe4ee",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "0px",
                        paddingBottom: "14px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "## Featured update\n\nShare the biggest story or insight first. A short explanation plus one strong CTA is usually enough.",
                        alignment: "left",
                        fontFamily: "Arial, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        foregroundColor: "#0f172a",
                        paddingTop: "0px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "link",
                    settings: {
                        text: "Read the feature",
                        url: "#",
                        alignment: "left",
                        isButton: true,
                        buttonColor: "#0f766e",
                        buttonTextColor: "#ffffff",
                        buttonBorderRadius: "8px",
                        buttonPaddingX: "20px",
                        buttonPaddingY: "11px",
                        buttonBorderWidth: "0px",
                        buttonBorderStyle: "solid",
                        buttonBorderColor: "#0f766e",
                        paddingTop: "4px",
                        paddingBottom: "16px",
                    },
                },
                {
                    blockType: "text",
                    settings: {
                        content:
                            "## Also inside\n\n- A quick tip or takeaway.\n- One resource worth sharing.\n- A subtle CTA to your offer or archive.",
                        alignment: "left",
                        fontFamily: "Arial, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        foregroundColor: "#0f172a",
                        paddingTop: "0px",
                        paddingBottom: "8px",
                    },
                },
                {
                    blockType: "separator",
                    settings: {
                        color: "#dbe4ee",
                        thickness: "1px",
                        style: "solid",
                        paddingTop: "18px",
                        paddingBottom: "10px",
                    },
                },
                createFooterEmailBlock({
                    fontFamily: "Arial, sans-serif",
                    paddingTop: "0px",
                    paddingBottom: "0px",
                }),
            ],
        },
    },
    {
        templateId: "system:blank",
        title: "Blank",
        description: "A blank marketing starter with a managed footer.",
        content: {
            style: {
                colors: {
                    background: "#ffffff",
                    foreground: "#111827",
                    border: "#ffffff",
                    accent: "#2563eb",
                    accentForeground: "#ffffff",
                },
                typography: {
                    header: {
                        fontFamily: "Helvetica, sans-serif",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    text: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        lineHeight: "1.7",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                    link: {
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "14px",
                        lineHeight: "1.5",
                        letterSpacing: "0px",
                        textTransform: "none",
                        textDecoration: "none",
                    },
                },
                interactives: {
                    button: {
                        padding: { x: "20px", y: "10px" },
                        border: { width: "0px", radius: "8px", style: "solid" },
                    },
                    link: { padding: { x: "0px", y: "0px" } },
                },
                structure: {
                    page: {
                        background: "#ffffff",
                        foreground: "#111827",
                        width: "640px",
                        marginY: "24px",
                        borderWidth: "0px",
                        borderStyle: "solid",
                        borderRadius: "0px",
                    },
                    section: { padding: { x: "32px", y: "18px" } },
                },
            },
            meta: {
                previewText: "A blank marketing starter with a managed footer.",
            },
            content: [
                {
                    blockType: "text",
                    settings: {
                        content:
                            "# Start writing here\n\nAdd your message, links, and call to action.",
                        alignment: "left",
                        fontFamily: "Helvetica, sans-serif",
                        fontSize: "16px",
                        foregroundColor: "#111827",
                        paddingTop: "12px",
                        paddingBottom: "12px",
                    },
                },
                createFooterEmailBlock({
                    fontFamily: "Helvetica, sans-serif",
                    paddingTop: "8px",
                    paddingBottom: "0px",
                }),
            ],
        },
    },
];

function transactionalContent(
    previewText: string,
    content: string,
): EmailContent {
    return {
        style: defaultEmail.style,
        meta: { previewText },
        content: [
            {
                blockType: "text",
                settings: {
                    content,
                    alignment: "left",
                    fontSize: "16px",
                    paddingTop: "24px",
                    paddingBottom: "24px",
                },
            },
        ],
    };
}

const TRANSACTIONAL_SYSTEM_TEMPLATES: Array<
    Omit<SystemTemplate, "requiredVariables">
> = [
    {
        templateId: "system:transactional:otp",
        title: "One-time password",
        description: "Send a short-lived code for sign-in or verification.",
        purpose: "transactional",
        content: transactionalContent(
            "Your one-time verification code",
            "# Your verification code\n\nUse this code to continue:\n\n## {{ otp }}\n\nIf you did not request this code, you can ignore this email.",
        ),
        variableDefinitions: [
            {
                path: "otp",
                description: "One-time verification code",
                example: "345987",
            },
        ],
    },
    {
        templateId: "system:transactional:magic-link",
        title: "Magic sign-in link",
        description: "Send a secure passwordless sign-in link.",
        purpose: "transactional",
        content: transactionalContent(
            "Your secure sign-in link",
            "# Sign in to your account\n\n[Sign in securely]({{ magic_link }})\n\nIf you did not request this link, you can ignore this email.",
        ),
        variableDefinitions: [
            {
                path: "magic_link",
                description: "Recipient-specific sign-in URL",
                example: "https://example.com/sign-in/token",
            },
        ],
    },
    {
        templateId: "system:transactional:password-reset",
        title: "Password reset",
        description: "Help a user securely reset their password.",
        purpose: "transactional",
        content: transactionalContent(
            "Reset your password",
            "# Reset your password\n\n[Choose a new password]({{ reset_url }})\n\nIf you did not request a password reset, you can ignore this email.",
        ),
        variableDefinitions: [
            {
                path: "reset_url",
                description: "Recipient-specific password reset URL",
                example: "https://example.com/reset/token",
            },
        ],
    },
    {
        templateId: "system:transactional:verify-email",
        title: "Email verification",
        description: "Verify ownership of a user's email address.",
        purpose: "transactional",
        content: transactionalContent(
            "Verify your email address",
            "# Verify your email address\n\n[Verify email]({{ verification_url }})\n\nThis link can only be used for your account.",
        ),
        variableDefinitions: [
            {
                path: "verification_url",
                description: "Recipient-specific email verification URL",
                example: "https://example.com/verify/token",
            },
        ],
    },
    {
        templateId: "system:transactional:invitation",
        title: "Account invitation",
        description: "Invite someone to join an account or workspace.",
        purpose: "transactional",
        content: transactionalContent(
            "You have been invited",
            "# You are invited\n\n{{ inviter.name }} invited you to join.\n\n[Accept invitation]({{ invitation_url }})",
        ),
        variableDefinitions: [
            {
                path: "inviter.name",
                description: "Name of the person sending the invitation",
                example: "Ada Lovelace",
            },
            {
                path: "invitation_url",
                description: "Recipient-specific invitation URL",
                example: "https://example.com/invitations/token",
            },
        ],
    },
    {
        templateId: "system:transactional:receipt",
        title: "Receipt",
        description: "Confirm an order and summarize its total.",
        purpose: "transactional",
        content: transactionalContent(
            "Receipt for order {{ order.id }}",
            "# Receipt\n\nOrder: **{{ order.id }}**\n\nTotal: **{{ order.total }}**\n\n{% for item in order.items %}- {{ item.name }} — {{ item.price }}\n{% endfor %}",
        ),
        variableDefinitions: [
            {
                path: "order.id",
                description: "Order identifier",
                example: "ORD-1001",
            },
            {
                path: "order.total",
                description: "Formatted order total",
                example: "$49.00",
            },
            {
                path: "order.items",
                description: "Purchased items",
                example: [{ name: "Pro plan", price: "$49.00" }],
            },
        ],
    },
    {
        templateId: "system:transactional:payment",
        title: "Payment confirmation",
        description: "Confirm that a payment was received.",
        purpose: "transactional",
        content: transactionalContent(
            "Payment received",
            "# Payment received\n\nPayment **{{ payment.id }}** for **{{ payment.amount }}** was successful.",
        ),
        variableDefinitions: [
            {
                path: "payment.id",
                description: "Payment identifier",
                example: "PAY-1001",
            },
            {
                path: "payment.amount",
                description: "Formatted payment amount",
                example: "$49.00",
            },
        ],
    },
    {
        templateId: "system:transactional:security-alert",
        title: "Security alert",
        description: "Notify a user about an important account event.",
        purpose: "transactional",
        content: transactionalContent(
            "Security alert for your account",
            "# Security alert\n\n{{ event }}\n\nOccurred at: {{ occurred_at }}\n\nIf this was not you, secure your account immediately.",
        ),
        variableDefinitions: [
            {
                path: "event",
                description: "Human-readable security event",
                example: "A new device signed in to your account.",
            },
            {
                path: "occurred_at",
                description: "Formatted event time",
                example: "25 July 2026 at 13:15 UTC",
            },
        ],
    },
    {
        templateId: "system:transactional:blank",
        title: "Blank transactional email",
        description: "Start a transactional email without marketing content.",
        purpose: "transactional",
        content: transactionalContent(
            "",
            "# Transactional email\n\nReplace this content with your message.",
        ),
        variableDefinitions: [],
    },
];

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
    ...MARKETING_SYSTEM_TEMPLATES.map((template) => ({
        ...template,
        purpose: "marketing" as const,
        requiredVariables: getRequiredTemplateVariables(
            template.content,
            "marketing",
        ),
    })),
    ...TRANSACTIONAL_SYSTEM_TEMPLATES.map((template) => ({
        ...template,
        requiredVariables: getRequiredTemplateVariables(
            template.content,
            "transactional",
        ),
    })),
];

export function getSystemTemplate(templateId: string): SystemTemplate | null {
    return SYSTEM_TEMPLATES.find((t) => t.templateId === templateId) ?? null;
}
