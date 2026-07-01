import type { Email as EmailContent } from "@sendlit/email-editor";

export interface SystemTemplate {
  templateId: string;
  title: string;
  description: string;
  content: EmailContent;
}

/**
 * Built-in starting points offered alongside a team's own saved templates
 * when creating a template, broadcast, sequence, or adding an email to a
 * sequence — ported from CourseLit's `templates/system-emails/*.json` +
 * `getSystemEmailTemplates` (`apps/web/graphql/mails/logic.ts`). Unlike
 * CourseLit these are static, in-code data rather than files read off disk at
 * request time, since they never change per-deployment; `resolveStartingTemplate`
 * in `templates/queries.ts` checks these before falling back to the DB, so a
 * broadcast/sequence/email can be seeded straight from one of these ids
 * without a team having to first duplicate it into its own template list.
 */
export const SYSTEM_TEMPLATES: SystemTemplate[] = [
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
            border: { width: "0px", radius: "999px", style: "solid" },
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
        {
          blockType: "text",
          settings: {
            content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
            alignment: "center",
            fontFamily: "Helvetica, sans-serif",
            fontSize: "12px",
            foregroundColor: "#64748b",
            paddingTop: "0px",
            paddingBottom: "0px",
          },
        },
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
            border: { width: "0px", radius: "999px", style: "solid" },
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
        {
          blockType: "text",
          settings: {
            content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
            alignment: "center",
            fontFamily: "Helvetica, sans-serif",
            fontSize: "12px",
            foregroundColor: "#64748b",
            paddingTop: "0px",
            paddingBottom: "0px",
          },
        },
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
            border: { width: "0px", radius: "999px", style: "solid" },
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
            content: "# Products your customers are ready to buy next",
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
        {
          blockType: "text",
          settings: {
            content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
            alignment: "center",
            fontFamily: "Helvetica, sans-serif",
            fontSize: "12px",
            foregroundColor: "#64748b",
            paddingTop: "0px",
            paddingBottom: "0px",
          },
        },
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
        {
          blockType: "text",
          settings: {
            content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
            alignment: "center",
            fontFamily: "Arial, sans-serif",
            fontSize: "12px",
            foregroundColor: "#64748b",
            paddingTop: "0px",
            paddingBottom: "0px",
          },
        },
      ],
    },
  },
  {
    templateId: "system:blank",
    title: "Blank",
    description:
      "A blank starter template with only content and unsubscribe placeholders.",
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
        previewText:
          "A blank starter template with only content and unsubscribe placeholders.",
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
        {
          blockType: "text",
          settings: {
            content: "{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
            alignment: "center",
            fontFamily: "Helvetica, sans-serif",
            fontSize: "12px",
            foregroundColor: "#64748b",
            paddingTop: "8px",
            paddingBottom: "0px",
          },
        },
      ],
    },
  },
];

export function getSystemTemplate(templateId: string): SystemTemplate | null {
  return SYSTEM_TEMPLATES.find((t) => t.templateId === templateId) ?? null;
}
