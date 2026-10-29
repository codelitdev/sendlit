import type { SendLitEmailRenderContext } from "@sendlit/email-blocks/footer";
import { type Email as EmailType, renderEmailToHtml } from "@sendlit/email-editor";
import { JSDOM } from "jsdom";
import { Liquid } from "liquidjs";
import { captureError } from "../observability";
import logger from "../services/log";
import { SENDLIT_FOOTER_BLOCK } from "../templates/footer";
import { isTrackingUrl, isViewInBrowserUrl } from "../utils/mail";

const liquidEngine = new Liquid();

export const MISSING_TEMPLATE_VARIABLES = "missing_template_variables";

/** A render failure caused by the email's content or the team's footer
 * settings. It repeats on every retry until one of them changes, unlike a
 * transient dependency error (database, entitlements) hit while rendering. */
export class EmailRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailRenderError";
  }
}

export class MissingTemplateVariablesError extends Error {
  readonly missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(MISSING_TEMPLATE_VARIABLES);
    this.name = "MissingTemplateVariablesError";
    this.missingVariables = missingVariables;
  }
}

type TemplateScope = {
  locals: Set<string>;
  active: boolean;
  kind: "root" | "if" | "for";
  /** Tracks whether an earlier branch in the current if/elsif/else chain
   * has already matched. */
  branchMatched?: boolean;
};

type VariablePath = {
  display: string;
  parts: string[];
};

const LIQUID_TOKEN = /{{-?\s*([\s\S]*?)\s*-?}}|{%-?\s*([\s\S]*?)\s*-?%}/g;
const LIQUID_LITERAL = new Set(["blank", "empty", "false", "nil", "null", "true"]);

function variablePath(expression: string): VariablePath | null {
  const match = expression
    .trim()
    .match(
      /^([A-Za-z_][A-Za-z0-9_-]*(?:\s*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\s*(?:"[^"]+"|'[^']+'|\d+)\s*\]))*)/,
    );
  if (!match || LIQUID_LITERAL.has(match[1])) return null;

  const parts = Array.from(
    match[1].matchAll(
      /[A-Za-z_][A-Za-z0-9_-]*|\[\s*(?:"([^"]+)"|'([^']+)'|(\d+))\s*\]/g,
    ),
    (segment) => segment[1] ?? segment[2] ?? segment[3] ?? segment[0],
  );
  if (parts.length === 0) return null;
  return { display: parts.join("."), parts };
}

function isPresent(variables: Record<string, unknown>, path: VariablePath) {
  let value: unknown = variables;
  for (const part of path.parts) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) {
      return false;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value !== undefined;
}

function valueAtPath(variables: Record<string, unknown>, path: VariablePath): unknown {
  return path.parts.reduce<unknown>(
    (value, part) => (value as Record<string, unknown>)[part],
    variables,
  );
}

/** Liquid considers only false and nil falsy; unlike JavaScript, `0` and an
 * empty string are truthy. */
function isTruthy(variables: Record<string, unknown>, path: VariablePath) {
  if (!isPresent(variables, path)) return false;
  const value = valueAtPath(variables, path);
  return value !== false && value !== null && value !== undefined;
}

function directConditionPath(condition: string): VariablePath | null {
  const path = variablePath(condition);
  if (!path) return null;
  const normalized = condition
    .trim()
    .replace(
      /\[\s*(?:"([^"]+)"|'([^']+)'|(\d+))\s*\]/g,
      (_match, doubleQuoted, singleQuoted, numeric) =>
        `.${doubleQuoted ?? singleQuoted ?? numeric}`,
    )
    .replace(/\s+/g, "");
  return normalized === path.display ? path : null;
}

function isInactiveScope(scopes: TemplateScope[]) {
  return scopes.some((scope) => !scope.active);
}

function isLocalVariable(scopes: TemplateScope[], path: VariablePath) {
  return scopes.some((scope) => scope.locals.has(path.parts[0]));
}

function hasLoopItems(value: unknown): boolean {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return value !== false && value !== null && value !== undefined;
}

/**
 * Finds values that Liquid would otherwise silently render as an empty string.
 * A `default` filter is an explicit opt-out, and a direct `{% if value %}`
 * guard makes the guarded branch optional when `value` is absent or false.
 */
export function findMissingTemplateVariables(
  source: string,
  variables: Record<string, unknown>,
): string[] {
  const missing = new Set<string>();
  const scopes: TemplateScope[] = [{ locals: new Set(), active: true, kind: "root" }];

  for (const match of source.matchAll(LIQUID_TOKEN)) {
    const output = match[1];
    const tag = match[2]?.trim();

    if (output !== undefined) {
      if (/\|\s*default(?:\s*:|\s*\|\s*|\s*$)/.test(output)) {
        continue;
      }
      const path = variablePath(output);
      if (
        path &&
        !isLocalVariable(scopes, path) &&
        !isInactiveScope(scopes) &&
        !isPresent(variables, path)
      ) {
        missing.add(path.display);
      }
      continue;
    }

    if (!tag) continue;
    const ifMatch = tag.match(/^(?:if|elsif)\s+(.+)$/);
    if (ifMatch) {
      const path = directConditionPath(ifMatch[1]);
      // For complex expressions, stay conservative and validate values
      // in the branch. Direct `{% if value %}` guards are the explicit
      // optional-value contract exposed in the API documentation.
      const conditionMatches = path ? isTruthy(variables, path) : true;
      if (tag.startsWith("elsif") && scopes.at(-1)?.kind === "if") {
        const scope = scopes.at(-1)!;
        scope.active =
          !scope.branchMatched &&
          !isInactiveScope(scopes.slice(0, -1)) &&
          conditionMatches;
        scope.branchMatched = scope.branchMatched || conditionMatches;
      } else {
        const parentActive = !isInactiveScope(scopes);
        scopes.push({
          locals: new Set(),
          active: parentActive && conditionMatches,
          kind: "if",
          branchMatched: conditionMatches,
        });
      }
      continue;
    }
    if (tag === "else" && scopes.at(-1)?.kind === "if") {
      const scope = scopes.at(-1)!;
      const parentActive = !isInactiveScope(scopes.slice(0, -1));
      scope.active = parentActive && !scope.branchMatched;
      scope.branchMatched = true;
      continue;
    }
    if (tag === "endif" && scopes.at(-1)?.kind === "if") {
      scopes.pop();
      continue;
    }
    const forMatch = tag.match(/^for\s+([A-Za-z_][A-Za-z0-9_-]*)\s+in\s+(.+)$/);
    if (forMatch) {
      const collection = variablePath(forMatch[2]);
      if (
        collection &&
        !isLocalVariable(scopes, collection) &&
        !isInactiveScope(scopes) &&
        !isPresent(variables, collection)
      ) {
        missing.add(collection.display);
      }
      const collectionIsPresent =
        collection !== null && isPresent(variables, collection);
      scopes.push({
        locals: new Set([forMatch[1], "forloop"]),
        active:
          !isInactiveScope(scopes) &&
          collectionIsPresent &&
          hasLoopItems(valueAtPath(variables, collection!)),
        kind: "for",
      });
      continue;
    }
    if (tag === "endfor" && scopes.at(-1)?.kind === "for") {
      scopes.pop();
    }
  }

  return [...missing].sort();
}

/** Returns the unconditional Liquid paths a template requires without relying
 * on caller-maintained metadata. Guarded branches and `default` filters remain
 * optional by the same rules used during send-time validation. */
export function discoverRequiredTemplateVariables(source: string): string[] {
  return findMissingTemplateVariables(source, {});
}

/** True when every non-empty mailing-address line appears in rendered text.
 * HTML email pipelines collapse raw newlines and the footer emits `<br>`, so
 * a literal `\n`-preserving `includes` check is not reliable. The renderer
 * may also wrap a long line with a newline and indentation, so whitespace is
 * collapsed on both sides before comparing. */
export function mailingAddressAppearsInText(
  text: string,
  mailingAddress: string,
): boolean {
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
  const lines = mailingAddress
    .split(/\r?\n/)
    .map(collapse)
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;
  const normalizedText = collapse(text);
  return lines.every((line) => normalizedText.includes(line));
}

/**
 * Shared by the campaign send loop (`automation/process-ongoing-sequence.ts`)
 * and the transactional send path: renders `@sendlit/email-editor` block
 * content to HTML, then runs the Liquid merge over it. Callers own what goes
 * into `variables` — the campaign path adds `subscriber`/`address`/
 * `unsubscribe_link`; the transactional path passes exactly the caller's
 * `variables`, nothing else (see `docs/transactional-emails.md`).
 */
export async function renderEmailContent({
  content,
  variables,
  requireVariables = false,
  brandingText,
  viewInBrowserUrl,
}: {
  content: EmailType;
  variables: Record<string, unknown>;
  /** Hosted web version, linked from the managed footer. */
  viewInBrowserUrl?: string;
  /** Transactional sends reject unguarded values that would render blank. */
  requireVariables?: boolean;
  /** Server-owned Free-plan branding; callers cannot supply it in template data. */
  brandingText?: string;
}): Promise<string> {
  const hasFooter = content.content.some((block) => block.blockType === "footer");
  let renderContext: SendLitEmailRenderContext | undefined;
  if (hasFooter) {
    const mailingAddress = variables.address;
    const unsubscribeUrl = variables.unsubscribe_link;
    if (
      typeof mailingAddress !== "string" ||
      mailingAddress.trim().length === 0 ||
      typeof unsubscribeUrl !== "string" ||
      unsubscribeUrl.trim().length === 0
    ) {
      const error = new EmailRenderError("footer_render_context_required");
      captureError({
        error,
        source: "mail.footer_context",
        severity: "error",
      });
      throw error;
    }
    renderContext = {
      footer: { mailingAddress, unsubscribeUrl, viewInBrowserUrl, brandingText },
    };
  }

  const html = await renderEmailToHtml({
    email: content,
    blocks: hasFooter ? [SENDLIT_FOOTER_BLOCK] : undefined,
    renderContext,
  });
  if (html.includes("<h1>Error:")) {
    throw new EmailRenderError("render_failed");
  }
  if (renderContext?.footer) {
    const document = new JSDOM(html).window.document;
    const text = document.body.textContent ?? "";
    // Multi-line addresses are rendered with <br> (or may have newlines
    // collapsed by the HTML pipeline), so never require a literal "\n"
    // match against textContent — require each non-empty line instead.
    const hasAddress = mailingAddressAppearsInText(
      text,
      renderContext.footer.mailingAddress,
    );
    const hasUnsubscribeUrl = Array.from(document.querySelectorAll("a")).some(
      (anchor) => anchor.getAttribute("href") === renderContext!.footer!.unsubscribeUrl,
    );
    if (!hasAddress || !hasUnsubscribeUrl) {
      const error = new EmailRenderError("footer_render_failed");
      captureError({
        error,
        source: "mail.footer_compliance_assertion",
        severity: "error",
      });
      throw error;
    }
  }
  const source = decodeLiquidTags(html);
  if (requireVariables) {
    const missingVariables = findMissingTemplateVariables(source, variables);
    if (missingVariables.length > 0) {
      throw new MissingTemplateVariablesError(missingVariables);
    }
  }
  return liquidEngine.parseAndRender(source, variables);
}

const LIQUID_TAG = /{{[\s\S]*?}}|{%[\s\S]*?%}/g;
const TAG_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

/** Block content is HTML-escaped before Liquid runs, which turns the quotes
 * of a string literal inside a tag (`{{ name | default: "friend" }}`) into
 * `&quot;` and breaks the parse. Inside `{{ }}`/`{% %}` entities are never
 * meant literally, so decode them there and nowhere else. */
export function decodeLiquidTags(html: string): string {
  return html.replace(LIQUID_TAG, (tag) =>
    tag.replace(
      /&(?:quot|#34|#39|#x27|apos|lt|gt|amp);/g,
      (entity) => TAG_ENTITIES[entity]!,
    ),
  );
}

/** Adds a 1x1 tracking pixel before rendering. Marketing content keeps its
 * managed footer as the final block; footer-free content receives the pixel
 * at the end. */
export function appendTrackingPixel(content: EmailType, pixelUrl: string): EmailType {
  const blocks = [...content.content];
  const pixel = {
    blockType: "image",
    settings: {
      src: pixelUrl,
      width: "1px",
      height: "1px",
      alt: "",
    },
  };
  const footerIndex = blocks.findIndex((block) => block.blockType === "footer");
  blocks.splice(footerIndex === -1 ? blocks.length : footerIndex, 0, pixel);

  return {
    ...content,
    content: blocks,
  };
}

/**
 * Appends a 1x1 tracking pixel directly to already-rendered HTML. Used by the
 * transactional path, where by send time the render step (template block
 * content, or verbatim inline `html`) has already produced a flat HTML
 * string — unlike the campaign path, which appends the pixel as a block
 * (`appendTrackingPixel`) before block content is rendered, because inline
 * `html` sends have no block model to append a block to.
 */
export function appendTrackingPixelToHtml(html: string, pixelUrl: string): string {
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${pixelTag}</body>`)
    : `${html}${pixelTag}`;
}

/**
 * Rewrites every `<a href>` in rendered HTML to route through the
 * click-tracking redirect, skipping tracking/unsubscribe/`mailto:`/`tel:`/
 * fragment links. `buildTrackedUrl` receives the original URL and the link's
 * index (both feed into the tracking token payload) and returns the
 * replacement href — kept caller-supplied so the campaign and transactional
 * paths can embed different token payloads without this function knowing
 * about either's identifiers.
 */
export function transformLinksForClickTracking(
  htmlContent: string,
  buildTrackedUrl: (originalUrl: string, index: number) => string,
  errorContext: Record<string, unknown> = {},
  /** The team's tracking domain origin, whose links are left alone too. */
  linkOrigin?: string,
): string {
  try {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    const links = document.querySelectorAll("a");

    links.forEach((link, index) => {
      const originalUrl = link.getAttribute("href");
      if (!originalUrl) return;
      if (
        isTrackingUrl(originalUrl, linkOrigin) ||
        isViewInBrowserUrl(originalUrl, linkOrigin) ||
        originalUrl.includes("/unsubscribe") ||
        originalUrl.startsWith("mailto:") ||
        originalUrl.startsWith("tel:") ||
        originalUrl.startsWith("#")
      ) {
        return;
      }

      link.setAttribute("href", buildTrackedUrl(originalUrl, index));
    });

    return dom.serialize();
  } catch (error: any) {
    logger.error({ error: error.message }, "transformLinksForClickTracking failed");
    captureError({
      error,
      source: "mail.click_tracking_transform",
      severity: "warning",
      context: errorContext,
    });
    return htmlContent;
  }
}
