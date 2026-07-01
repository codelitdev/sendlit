import { NextRequest, NextResponse } from "next/server";
import { TEAM_ID_COOKIE } from "@/lib/tokens";

/**
 * Sets which team the dashboard is "in" — a plain cookie (not a secret; the
 * API re-validates membership on every request via `X-Sendlit-Team-Id`, see
 * `apps/api/src/auth/require-team.ts`). Submitted as a regular form POST
 * (same pattern as `/api/auth/logout`) so switching works with a plain
 * `<form>`, no client JS required.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const teamId = String(form.get("teamId") || "");
  const redirectTo = String(form.get("redirectTo") || "/dashboard");

  const res = NextResponse.redirect(new URL(redirectTo, req.url));
  if (teamId) {
    const isProd = process.env.NODE_ENV === "production";
    // Not httpOnly, deliberately: this is just a "which team am I looking
    // at" selection, not a credential — the dashboard reads it client-side
    // to render the current team, and every API call is re-validated
    // against team membership server-side regardless of what it says.
    res.cookies.set(TEAM_ID_COOKIE, teamId, {
      httpOnly: false,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
