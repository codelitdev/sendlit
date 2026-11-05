import type { Email, EmailBlock, EmailStyle } from "../types/email-editor";

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
      ...darkAccent(style.colors.accent),
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

type Rgb = [number, number, number];

const DARK_PAGE: Rgb = [0x1c / 255, 0x1c / 255, 0x1e / 255];

/** Links use the accent as text, so a dark accent is lightened until it reads
 * on the dark page, and buttons get text that reads on the new accent. */
function darkAccent(accent: string): Partial<EmailStyle["colors"]> {
  const rgb = toRgb(accent);
  if (!rgb || contrast(rgb, DARK_PAGE) >= 4.6) return {};
  const next = readable(rgb, DARK_PAGE, [1, 1, 1]);
  const ink: Rgb =
    contrast(next, [1, 1, 1]) >= contrast(next, DARK_PAGE) ? [1, 1, 1] : DARK_PAGE;
  return { accent: toHex(next), accentForeground: toHex(ink) };
}

function toRgb(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits =
    match[1].length === 3
      ? [...match[1]].map((digit) => digit + digit).join("")
      : match[1];
  return [0, 2, 4].map(
    (at) => Number.parseInt(digits.slice(at, at + 2), 16) / 255,
  ) as Rgb;
}

function luminance([r, g, b]: Rgb) {
  const linear = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The colour with its lightness flipped and clamped, hue and saturation kept. */
function flipLightness([r, g, b]: Rgb, clamp: (lightness: number) => number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  const next = clamp(1 - lightness);
  const chroma = (1 - Math.abs(2 * next - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = next - chroma / 2;
  const [r1, g1, b1] =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${[r1, g1, b1]
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const TEXT_COLORS = ["foregroundColor", "textColor"];
const SURFACE_COLORS = ["backgroundColor", "borderColor", "color"];

/** A block's own colours as a dark-mode mail client shows them: dark text is
 * lightened and light backgrounds and lines are darkened, while mid-tone
 * colours such as a button's stay. Without this, a block that sets its own
 * text colour reads dark on dark. */
export function darkBlock<T extends EmailBlock>(block: T): T {
  const settings = { ...(block.settings as Record<string, unknown>) };
  let changed = false;
  for (const key of [...TEXT_COLORS, ...SURFACE_COLORS]) {
    const value = settings[key];
    const rgb = typeof value === "string" ? toRgb(value) : null;
    if (!rgb) continue;
    const text = TEXT_COLORS.includes(key);
    if (text ? luminance(rgb) >= 0.3 : luminance(rgb) <= 0.5) continue;
    settings[key] = flipLightness(rgb, (lightness) =>
      text ? Math.max(lightness, 0.75) : Math.min(Math.max(lightness, 0.12), 0.2),
    );
    changed = true;
  }
  return changed ? { ...block, settings } : block;
}

function toHex(rgb: Rgb) {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}` as `#${string}`;
}

/** Where a colour sits between the page (0) and the text colour (1). */
function tone(color: Rgb, page: Rgb, text: Rgb) {
  const axis = text.map((channel, at) => channel - page[at]);
  const length = axis.reduce((sum, part) => sum + part * part, 0);
  if (length === 0) return 1;
  return (
    color.reduce((sum, channel, at) => sum + (channel - page[at]) * axis[at], 0) /
    length
  );
}

const mix = (from: Rgb, to: Rgb, amount: number) =>
  from.map((channel, at) => channel + (to[at] - channel) * amount) as Rgb;

/** A hex colour `amount` of the way from one colour to another, for tints
 * that must be plain hex in an email. `fallback` when either can't be read. */
export function blend(from: string, to: string, amount: number, fallback: string) {
  const a = toRgb(from);
  const b = toRgb(to);
  return a && b ? toHex(mix(a, b, amount)) : fallback;
}

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `color`, moved toward `toward` just far enough to read on `background`
 * (WCAG AA is 4.5:1; 4.6 leaves room for rounding to hex). */
function readable(color: Rgb, background: Rgb, toward: Rgb): Rgb {
  for (let amount = 0; amount <= 1; amount += 0.05) {
    const next = mix(color, toward, amount);
    if (contrast(next, background) >= 4.6) return next;
  }
  return toward;
}

/** The email's blocks recoloured for a palette. Without this, blocks that set
 * their own colours stay as they were, dark on dark in a dark palette: text and
 * backgrounds keep their tone between page and text (muted body text stays
 * muted), buttons take the accent, and dividers and links follow the palette. */
export function paletteContent(email: Email, palette: Palette): EmailBlock[] {
  const oldPage = toRgb(email.style.structure.page.background ?? "#ffffff");
  const oldText = toRgb(
    email.style.structure.page.foreground ?? email.style.colors.foreground,
  );
  const newPage = toRgb(palette.page) as Rgb;
  const newText = toRgb(palette.text) as Rgb;
  const retone = (value: unknown, min: number) => {
    const rgb = typeof value === "string" ? toRgb(value) : null;
    if (!rgb || !oldPage || !oldText) return value;
    const at = Math.min(1, Math.max(min, tone(rgb, oldPage, oldText)));
    return toHex(mix(newPage, newText, at));
  };
  return email.content.map((block) => {
    const settings = { ...(block.settings as Record<string, unknown>) };
    if ("foregroundColor" in settings) {
      const toned = toRgb(String(retone(settings.foregroundColor, 0.6)));
      // Never fainter than readable on the new page.
      if (toned) settings.foregroundColor = toHex(readable(toned, newPage, newText));
    }
    if ("backgroundColor" in settings) {
      settings.backgroundColor = retone(settings.backgroundColor, 0);
    }
    if (block.blockType === "link") {
      delete settings.textColor;
      if ("buttonColor" in settings) settings.buttonColor = palette.accent;
      if ("buttonBorderColor" in settings) settings.buttonBorderColor = palette.accent;
      if ("buttonTextColor" in settings) settings.buttonTextColor = palette.accentText;
    }
    if (block.blockType === "separator") delete settings.color;
    return { ...block, settings } as typeof block;
  });
}
