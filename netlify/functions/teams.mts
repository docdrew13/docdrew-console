import type { Config } from "@netlify/functions";

// TEMPORARY DIAGNOSTIC BUILD — returns a static response immediately,
// with no outbound fetch at all, to isolate whether the 502s are coming
// from this function's own runtime/routing or specifically from the
// outbound call to ESPN. Will be reverted once diagnosed.
export default async (req: Request) => {
  return new Response(
    JSON.stringify({ diag: "static_ok_no_fetch", now: new Date().toISOString() }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

export const config: Config = { path: "/api/teams" };
