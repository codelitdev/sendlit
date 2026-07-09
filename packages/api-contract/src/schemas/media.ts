import { z } from "zod";

export const mediaSchema = z.object({
    mediaId: z.string(),
    url: z.string(),
    thumbnailUrl: z.string().nullable().optional(),
    mediaLitId: z.string(),
    fileName: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    size: z.number().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    alt: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).nullable().optional(),
    updatedAt: z.string().or(z.date()).nullable().optional(),
});

export const mediaReferenceSchema = z.object({
    resourceType: z.enum(["TEMPLATE", "SEQUENCE_EMAIL"]),
    resourcePublicId: z.string(),
    parentResourcePublicId: z.string().nullable().optional(),
    createdAt: z.string().or(z.date()).nullable().optional(),
    updatedAt: z.string().or(z.date()).nullable().optional(),
});

export const listMediaQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    query: z.string().optional(),
});

export const updateMediaBodySchema = z.object({
    alt: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
});

export const mediaUploadSignatureSchema = z.object({
    signature: z.string(),
    endpoint: z.string(),
});
