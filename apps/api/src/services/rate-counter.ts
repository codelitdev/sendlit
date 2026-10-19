import { captureError } from "../observability";
import { sharedRedis } from "./redis-client";

/**
 * Counts one event against `limit` per `windowSeconds` (a fixed window that
 * starts at the first event) shared by every API process. Returns false
 * when the limit is used up. A Redis outage lets the event through.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const [[, count]] = (await sharedRedis()
      .multi()
      .incr(`sendlit:limit:${key}`)
      .expire(`sendlit:limit:${key}`, windowSeconds, "NX")
      .exec()) as [[null, number], unknown];
    return count <= limit;
  } catch (error) {
    captureError({ error, source: "services.rate_counter", severity: "warning" });
    return true;
  }
}
