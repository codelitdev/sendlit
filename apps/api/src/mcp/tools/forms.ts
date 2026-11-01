import { createSignupFormBodySchema, signupFormSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  createForm,
  deleteForm,
  FormSenderError,
  getForm,
  listForms,
  toPublicForms,
  updateForm,
} from "../../forms/queries";
import type { SendLitMcpTool } from "../context";
import { dedicatedTool } from "../tool";
import { notFound, toolError } from "./responses";

/** Double opt-in needs a sender; explain instead of failing generically. */
async function withSenderCheck(run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FormSenderError) {
      return toolError("conflict", {
        reason: "confirmation_sender_unavailable",
        message: error.issue,
      });
    }
    throw error;
  }
}

export const formTools = (): SendLitMcpTool[] => [
  dedicatedTool({
    name: "list_signup_forms",
    title: "List Signup Forms",
    operationId: "forms.list",
    risk: "read",
    description: "Lists the team's public signup forms with their hosted URLs.",
    inputSchema: z.object({}),
    outputSchema: z.object({ items: z.array(signupFormSchema) }),
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context }) {
      return {
        items: await toPublicForms(context.teamId, await listForms(context.teamId)),
      };
    },
  }),

  dedicatedTool({
    name: "create_signup_form",
    title: "Create Signup Form",
    operationId: "forms.create",
    risk: "write",
    description:
      "Creates a public signup form. People subscribe on its hosted page (`url`) or via an HTML form on any site posting `email` (and `name`) to that URL. Double opt-in (default) emails a confirmation link first; new subscribers get the form's tags and trigger subscriber:added sequences (e.g. a welcome email). Double opt-in needs a sending mailbox: without one this fails with confirmation_sender_unavailable. `sendingIssue` on a form says why its confirmations can't be sent.",
    inputSchema: createSignupFormBodySchema,
    outputSchema: signupFormSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      return withSenderCheck(
        async () =>
          (
            await toPublicForms(context.teamId, [
              await createForm(context.teamId, args),
            ])
          )[0],
      );
    },
  }),

  dedicatedTool({
    name: "get_signup_form",
    title: "Get Signup Form",
    operationId: "forms.get",
    risk: "read",
    description: "Returns one signup form.",
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: signupFormSchema,
    annotations: { idempotentHint: true, openWorldHint: false },
    async handler({ context, args }) {
      const form = await getForm(context.teamId, args.formId);
      return form ? (await toPublicForms(context.teamId, [form]))[0] : notFound();
    },
  }),

  dedicatedTool({
    name: "update_signup_form",
    title: "Update Signup Form",
    operationId: "forms.update",
    risk: "write",
    description:
      "Updates a signup form's name, tags, double opt-in or redirect URL. Turning double opt-in on fails with confirmation_sender_unavailable when the team has no sending mailbox.",
    inputSchema: createSignupFormBodySchema.partial().extend({ formId: z.string() }),
    outputSchema: signupFormSchema,
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      const { formId, ...patch } = args;
      return withSenderCheck(async () => {
        const form = await updateForm(context.teamId, formId, patch);
        return form ? (await toPublicForms(context.teamId, [form]))[0] : notFound();
      });
    },
  }),

  dedicatedTool({
    name: "delete_signup_form",
    title: "Delete Signup Form",
    operationId: "forms.remove",
    risk: "destructive",
    description: "Deletes a signup form; its URL stops accepting signups.",
    inputSchema: z.object({ formId: z.string() }),
    outputSchema: z.object({ deleted: z.boolean() }),
    annotations: { openWorldHint: false },
    async handler({ context, args }) {
      return (await deleteForm(context.teamId, args.formId))
        ? { deleted: true }
        : notFound();
    },
  }),
];
