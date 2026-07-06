import { z } from "zod";

const customFieldScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const customFieldValueSchema = z.union([
    customFieldScalarSchema,
    z.array(customFieldScalarSchema),
]);

export const customFieldsSchema = z.record(customFieldValueSchema).default({});

export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;
export type CustomFields = z.infer<typeof customFieldsSchema>;
