import { loader, multiple } from "fumadocs-core/source";
import { openapiPlugin, openapiSource } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";
import { openapi } from "@/lib/openapi";
import { docs } from "../.source/server";

const apiSource: any = await openapiSource(openapi, {
  baseDir: "api-reference",
});

export const source: any = loader({
  baseUrl: "/",
  source: multiple({
    docs: docs.toFumadocsSource() as any,
    openapi: apiSource,
  }) as any,
  plugins: [openapiPlugin()],
  icon(icon) {
    if (icon && icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }
  },
});
