/** Liveness for uptime monitors: the dashboard is serving requests. Needs no
 * sign-in and touches nothing else; the API has its own `/health` and
 * `/ready`. */
export function GET() {
  return Response.json(
    { status: "ok", service: "sendlit-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
