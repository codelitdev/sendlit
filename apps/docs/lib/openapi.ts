import { openApiDocument } from "@sendlit/api-contract/openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

export const openapi = createOpenAPI({
  input: () => {
    return {
      "sendlit-openapi": openApiDocument as any,
    };
  },
});
