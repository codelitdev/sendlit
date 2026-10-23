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
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import { AUTH_ERROR, errorResult, jsonResult, NOT_FOUND } from "./responses";

/** Double opt-in needs a sender; explain instead of failing generically. */
async function withSenderCheck(run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof FormSenderError) {
      return errorResult(`confirmation_sender_unavailable: ${error.issue}`);
    }
    throw error;
  }
}

export function registerFormTools(server: McpToolRegistrar): void {
  server.registerTool(
    "list_signup_forms",
    {
      description: "Lists the team's public signup forms with their hosted URLs.",
      outputSchema: z.object({ items: z.array(signupFormSchema) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return jsonResult({
        items: await toPublicForms(teamId, await listForms(teamId)),
      });
    },
  );

  server.registerTool(
    "create_signup_form",
    {
      description:
        "Creates a public signup form. People subscribe on its hosted page (`url`) or via an HTML form on any site posting `email` (and `name`) to that URL. Double opt-in (default) emails a confirmation link first; new subscribers get the form's tags and trigger subscriber:added sequences (e.g. a welcome email). Double opt-in needs a sending mailbox: without one this fails with confirmation_sender_unavailable. `sendingIssue` on a form says why its confirmations can't be sent.",
      inputSchema: createSignupFormBodySchema.shape,
      outputSchema: signupFormSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return withSenderCheck(async () =>
        jsonResult((await toPublicForms(teamId, [await createForm(teamId, args)]))[0]),
      );
    },
  );

  server.registerTool(
    "get_signup_form",
    {
      description: "Returns one signup form.",
      inputSchema: { formId: z.string() },
      outputSchema: signupFormSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const form = await getForm(teamId, args.formId);
      return form ? jsonResult((await toPublicForms(teamId, [form]))[0]) : NOT_FOUND;
    },
  );

  server.registerTool(
    "update_signup_form",
    {
      description:
        "Updates a signup form's name, tags, double opt-in or redirect URL. Turning double opt-in on fails with confirmation_sender_unavailable when the team has no sending mailbox.",
      inputSchema: {
        formId: z.string(),
        ...createSignupFormBodySchema.partial().shape,
      },
      outputSchema: signupFormSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      const { formId, ...patch } = args;
      return withSenderCheck(async () => {
        const form = await updateForm(teamId, formId, patch);
        return form ? jsonResult((await toPublicForms(teamId, [form]))[0]) : NOT_FOUND;
      });
    },
  );

  server.registerTool(
    "delete_signup_form",
    {
      description: "Deletes a signup form; its URL stops accepting signups.",
      inputSchema: { formId: z.string() },
      outputSchema: z.object({ deleted: z.boolean() }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args: any, extra: any) => {
      const teamId = getTeamId(extra);
      if (!teamId) return AUTH_ERROR;
      return (await deleteForm(teamId, args.formId))
        ? jsonResult({ deleted: true })
        : NOT_FOUND;
    },
  );
}
