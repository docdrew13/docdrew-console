import type { Config } from "@netlify/functions";

// Powers the Sports panel's team picker: given a league, returns every team ESPN
// knows about in that league so the frontend can offer a live, accurate dropdown
// instead of a hand-maintained (and easily stale/wrong) list of team IDs.
// Sport/league slugs mirror ESPN's own hidden "site.api" URL convention, already
// used successfully elsewhere in this project (see sports.mts, TEAM_FEEDS).
const ALLOWED: Record<string, string> = {
  nfl: "football/nfl",
  "college-football": "football/college-football",
  nba: "basketball/nba",
  "mens-college-basketball": "basketball/mens-college-basketball",
  "womens-college-basketball": "basketball/womens-college-basketball",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
};

export default async (req: Request) => {
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
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=999`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
      },
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: "diag_upstream_not_ok",
          status: res.status,
          statusText: res.statusText,
          bodySnippet: bodyText.slice(0, 500),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
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
    return new Response(
      JSON.stringify({
        error: "diag_fetch_threw",
        message: String(err),
        errName: err instanceof Error ? err.name : typeof err,
        errStack: err instanceof Error ? String(err.stack).slice(0, 800) : null,
        errCause: err instanceof Error && (err as any).cause ? String((err as any).cause) : null,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/teams" };
