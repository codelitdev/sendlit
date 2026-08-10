import {
    fromJsonSchema,
    type JsonSchemaType,
    type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function toMcpSchema(schema: ZodTypeAny): StandardSchemaWithJSON {
    const jsonSchema = zodToJsonSchema(schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
        errorMessages: true,
    }) as JsonSchemaType;
    return fromJsonSchema(jsonSchema);
}

export function toMcpObjectSchema(
    shape: ZodRawShape | undefined,
): StandardSchemaWithJSON {
    return toMcpSchema(z.object(shape ?? {}));
}
