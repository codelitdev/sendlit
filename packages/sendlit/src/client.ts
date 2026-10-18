import { SendLitError } from "./errors";
import { HttpClient } from "./http";
import { Contacts } from "./resources/contacts";
import { DeliveryEvents } from "./resources/delivery-events";
import { Emails } from "./resources/emails";
import { Provisioning } from "./resources/provisioning";
import { Segments } from "./resources/segments";
import { Sequences } from "./resources/sequences";
import { Suppressions } from "./resources/suppressions";
import { Templates } from "./resources/templates";
import { assertId } from "./validate";

export const DEFAULT_ENDPOINT = "https://api.sendlit.app";

const ORGANIZATION_KEY_PREFIX = "sl_org_live_";

export interface SendLitOptions {
  /**
   * A team API key (`sl_live_…`, sent as `x-sendlit-apikey`) or an
   * organization key (`sl_org_live_…`, sent as a Bearer token). Defaults
   * to `SENDLIT_API_KEY`.
   */
  apiKey?: string;
  /** An OAuth access token, sent as `Authorization: Bearer`. Use instead
   * of `apiKey`. */
  accessToken?: string;
  /** API base URL. Defaults to `SENDLIT_ENDPOINT`, then the hosted API. */
  endpoint?: string;
  /** Team to act on (`x-sendlit-team-id`) when the credential can reach
   * more than one team. Team keys are already bound to a single team.
   * Defaults to `SENDLIT_TEAM_ID`. */
  teamId?: string;
  /** Retries for rate-limited (429) calls, and for 5xx / network errors
   * on calls that are safe to repeat. Default `2`. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default `30000`. */
  timeout?: number;
  /** Custom `fetch` implementation (defaults to the global one). */
  fetch?: typeof fetch;
}

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return value || undefined;
}

function configError(message: string): SendLitError {
  return new SendLitError({ status: 0, code: "invalid_config", message });
}

export class SendLit {
  readonly contacts: Contacts;
  readonly segments: Segments;
  readonly templates: Templates;
  /** Broadcasts and sequences. */
  readonly sequences: Sequences;
  /** Transactional emails. */
  readonly emails: Emails;
  readonly provisioning: Provisioning;
  readonly suppressions: Suppressions;
  readonly deliveryEvents: DeliveryEvents;

  constructor(options: SendLitOptions = {}) {
    const g = globalThis as { window?: { document?: unknown } };
    if (g.window?.document) {
      throw configError(
        "The SendLit SDK is server-only. Never expose your API key in browser code.",
      );
    }

    if (options.apiKey && options.accessToken) {
      throw configError("Provide either apiKey or accessToken, not both");
    }
    const accessToken = options.accessToken;
    const apiKey = accessToken ? undefined : (options.apiKey ?? env("SENDLIT_API_KEY"));
    if (!apiKey && !accessToken) {
      throw configError(
        "Missing credentials: pass apiKey or accessToken, or set SENDLIT_API_KEY",
      );
    }

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    } else if (apiKey!.startsWith(ORGANIZATION_KEY_PREFIX)) {
      headers.authorization = `Bearer ${apiKey}`;
    } else {
      headers["x-sendlit-apikey"] = apiKey!;
    }
    const teamId = options.teamId ?? env("SENDLIT_TEAM_ID");
    if (teamId) headers["x-sendlit-team-id"] = assertId(teamId, "teamId");

    const endpoint = (
      options.endpoint ??
      env("SENDLIT_ENDPOINT") ??
      DEFAULT_ENDPOINT
    ).replace(/\/+$/, "");
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw configError(
        "No fetch implementation found. Use Node.js 18+ or pass `fetch`.",
      );
    }

    const http = new HttpClient({
      endpoint,
      headers,
      maxRetries: options.maxRetries ?? 2,
      timeout: options.timeout ?? 30_000,
      fetch: fetchImpl,
    });
    this.contacts = new Contacts(http);
    this.segments = new Segments(http);
    this.templates = new Templates(http);
    this.sequences = new Sequences(http);
    this.emails = new Emails(http);
    this.provisioning = new Provisioning(http);
    this.suppressions = new Suppressions(http);
    this.deliveryEvents = new DeliveryEvents(http);
  }
}
