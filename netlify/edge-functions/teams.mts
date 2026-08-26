import type { Config, Context } from "@netlify/edge-functions";

// Same team-picker logic as the old netlify/functions/teams.mts, but running as an
// Edge Function instead. Netlify's regular serverless Functions run on AWS Lambda,
// and ESPN's unofficial site.api appears to be blocking/dropping connections from
// that IP range specifically (browser-style user-agent didn't help, and even a
// bare, fetch-free function 502'd only when this exact route was hit repeatedly —
// pointing at the platform, not our code). Edge Functions run on a different
// network (Netlify's edge/Deno Deploy infrastructure), so this tests whether that
// sidesteps the block entirely.
const ALLOWED: Record<string, string> = {
  nfl: "football/nfl",
  "college-football": "football/college-football",
  nba: "basketball/nba",
  "mens-college-basketball": "basketball/mens-college-basketball",
  "womens-college-basketball": "basketball/womens-college-basketball",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const league = url.searchParams.get("league") || "";
  const path = ALLOWED[league];
  if (!path) {
    return new Response(JSON.stringify({ error: "unknown_league", known: Object.keys(ALLOWED) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=999`, {
        headers: { "user-agent": BROWSER_UA, accept: "application/json, text/plain, */*" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) throw new Error("upstream status " + res.status);
    const data = await res.json();
    const groups: any[] = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const teams = groups
      .map((g: any) => g.team)
      .filter(Boolean)
      .map((t: any) => ({ id: String(t.id), name: t.displayName || t.name || t.shortDisplayName || "" }))
      .filter((t: any) => t.id && t.name)
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ league, teams, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};

export const config: Config = { path: ["/api/teams", "/api/teams-diag"] };
