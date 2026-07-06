import { z } from "zod";
import { contactFilterSchema } from "./sequences";

export const segmentSchema = z.object({
    segmentId: z.string(),
    name: z.string(),
    filter: contactFilterSchema,
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

export const createSegmentBodySchema = z.object({
    name: z.string().min(1),
    filter: contactFilterSchema,
});

export const updateSegmentBodySchema = z.object({
    name: z.string().min(1).optional(),
    filter: contactFilterSchema.optional(),
});
