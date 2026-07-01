import { z } from "zod";

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerAccountId: z.string(),
  externalId: z.string().nullable().optional(),
  fromName: z.string().nullable().optional(),
  fromEmail: z.string().nullable().optional(),
  mailingAddress: z.string().nullable().optional(),
  dailyMailLimit: z.number(),
  monthlyMailLimit: z.number(),
  dailyMailCount: z.number(),
  monthlyMailCount: z.number(),
  countersResetAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export const apiKeySchema = z.object({
  id: z.string(),
  teamId: z.string(),
  key: z.string(),
  name: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

export const createTeamBodySchema = z.object({ name: z.string().min(1) });
export const renameTeamBodySchema = z.object({ name: z.string().min(1) });
export const createApiKeyBodySchema = z.object({ name: z.string().min(1) });

export const provisionTeamBodySchema = z.object({
  externalId: z.string().min(1),
  ownerEmail: z.string().email(),
  name: z.string().min(1),
});

export const provisionTeamResponseSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  apiKey: z.string().optional(),
});
