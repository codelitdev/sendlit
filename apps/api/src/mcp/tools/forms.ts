import { createSignupFormBodySchema, signupFormSchema } from "@sendlit/api-contract";
import { z } from "zod";
import {
  createForm,
  deleteForm,
  getForm,
  listForms,
  toPublicForm,
  updateForm,
} from "../../forms/queries";
import type { McpToolRegistrar } from "../tool-registry";
import { getTeamId } from "./auth";
import { AUTH_ERROR, jsonResult, NOT_FOUND } from "./responses";

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
      return jsonResult({ items: (await listForms(teamId)).map(toPublicForm) });
    },
  );

  server.registerTool(
    "create_signup_form",
    {
      description:
        "Creates a public signup form. People subscribe on its hosted page (`url`) or via an HTML form on any site posting `email` (and `name`) to that URL. Double opt-in (default) emails a confirmation link first; new subscribers get the form's tags and trigger subscriber:added sequences (e.g. a welcome email).",
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
      return jsonResult(toPublicForm(await createForm(teamId, args)));
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
      return form ? jsonResult(toPublicForm(form)) : NOT_FOUND;
    },
  );

  server.registerTool(
    "update_signup_form",
    {
      description: "Updates a signup form's name, tags, double opt-in or redirect URL.",
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
      const form = await updateForm(teamId, formId, patch);
      return form ? jsonResult(toPublicForm(form)) : NOT_FOUND;
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
