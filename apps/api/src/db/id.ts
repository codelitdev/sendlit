import { uuidv7 } from "uuidv7";
import { customAlphabet } from "nanoid";

const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const randomSuffix = customAlphabet(alphabet, 24);

/**
 * Internal surrogate primary key for every table — UUIDv7, so inserts stay
 * roughly time-ordered (unlike UUIDv4/`gen_random_uuid()`, which scatters
 * inserts randomly across the B-tree and hurts index locality/vacuum
 * behavior at scale). Never returned by any REST/MCP response — see
 * `utils/public.ts`. FKs between tables always reference this column.
 */
export function genId(): string {
    return uuidv7();
}

/**
 * Public-facing resource identifier: `<prefix>_<24 random alphanumeric
 * chars>` (~142 bits of entropy — same order as a UUID, plus a human/debug
 * -readable type prefix, mirroring Stripe/Shopify-style IDs). This is the
 * only identifier ever exposed to API/MCP consumers for a given resource,
 * and the only one ever used to look a row up from the outside.
 */
export function genPublicId(prefix: string): string {
    return `${prefix}_${randomSuffix()}`;
}
