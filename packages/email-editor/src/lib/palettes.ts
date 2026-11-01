import type { Email, EmailStyle } from "../types/email-editor";

export interface Palette {
  name: string;
  canvas: `#${string}`;
  page: `#${string}`;
  text: `#${string}`;
  border: `#${string}`;
  accent: `#${string}`;
  accentText: `#${string}`;
}

export const PALETTES: Palette[] = [
  {
    name: "Default",
    canvas: "#f1f5f9",
    page: "#ffffff",
    text: "#0f172a",
    border: "#e2e8f0",
    accent: "#2563eb",
    accentText: "#ffffff",
  },
  {
    name: "Warm",
    canvas: "#f5efe6",
    page: "#fffdf9",
    text: "#2b2118",
    border: "#eadfce",
    accent: "#c2410c",
    accentText: "#ffffff",
  },
  {
    name: "Forest",
    canvas: "#eef3ee",
    page: "#ffffff",
    text: "#14261b",
    border: "#d7e3d9",
    accent: "#15803d",
    accentText: "#ffffff",
  },
  {
    name: "Mono",
    canvas: "#f4f4f5",
    page: "#ffffff",
    text: "#18181b",
    border: "#e4e4e7",
    accent: "#18181b",
    accentText: "#ffffff",
  },
  {
    name: "Plain",
    canvas: "#ffffff",
    page: "#ffffff",
    text: "#1f2937",
    border: "#ffffff",
    accent: "#4f46e5",
    accentText: "#ffffff",
  },
  {
    name: "Night",
    canvas: "#0b1020",
    page: "#111827",
    text: "#e5e7eb",
    border: "#1f2937",
    accent: "#60a5fa",
    accentText: "#0b1020",
  },
];

/** The partial style a palette sets. Merge it over the email's style. */
export function paletteStyle(palette: Palette): Partial<EmailStyle> {
  return {
    colors: {
      background: palette.canvas,
      foreground: palette.text,
      border: palette.border,
      accent: palette.accent,
      accentForeground: palette.accentText,
    },
    structure: {
      page: { background: palette.page, foreground: palette.text },
      section: {},
    },
  };
}

export function activePalette(email: Email): string | null {
  const { colors, structure } = email.style;
  return (
    PALETTES.find(
      (palette) =>
        palette.canvas === colors.background &&
        palette.page === structure.page.background &&
        palette.text === colors.foreground &&
        palette.accent === colors.accent,
    )?.name ?? null
  );
}

/** What a dark-mode mail client does to the email: it dims the page and flips
 * the text. The accent stays, as it does in most clients. */
export function darkStyle(style: EmailStyle): EmailStyle {
  return {
    ...style,
    colors: {
      ...style.colors,
      background: "#000000",
      foreground: "#e7e7ea",
      border: "#333336",
    },
    structure: {
      ...style.structure,
      page: { ...style.structure.page, background: "#1c1c1e", foreground: "#e7e7ea" },
    },
  };
}
