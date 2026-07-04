import { createElement } from "react";
import { icons } from "lucide-react";
import { loader } from "fumadocs-core/source";
import { docs } from "../.source/server";

export const source: any = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource() as any,
  icon(icon) {
    if (icon && icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }
  },
});
