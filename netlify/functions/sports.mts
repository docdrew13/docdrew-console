import type { Config } from "@netlify/functions";

interface GameSummary {
  date: string;
  completed: boolean;
  statusText: string;
  opponent: string;
  homeAway: string;
  teamScore: string | null;
  oppScore: string | null;
  win: boolean | null;
}

const TEAM_FEEDS: Record<string, { sport: string; league: string; teamId: string; label: string }> = {
  "michigan-fb": { sport: "football", league: "college-football", teamId: "130", label: "Michigan Football" },
  "michigan-mbb": { sport: "basketball", league: "mens-college-basketball", teamId: "130", label: "Michigan Men's Basketball" },
  "michigan-wbb": { sport: "basketball", league: "womens-college-basketball", teamId: "130", label: "Michigan Women's Basketball" },
  "uconn-mbb": { sport: "basketball", league: "mens-college-basketball", teamId: "41", label: "UConn Men's Basketball" },
  "uconn-wbb": { sport: "basketball", league: "womens-college-basketball", teamId: "41", label: "UConn Women's Basketball" },
};

// Sport/league slug pairs the client is allowed to request via feed=custom — mirrors the
// catalog teams.mts exposes for its team-picker dropdown, so any team a user can pick
// there is guaranteed fetchable here too.
const ALLOWED_LEAGUES: Record<string, string> = {
  nfl: "football",
  "college-football": "football",
  nba: "basketball",
  "mens-college-basketball": "basketball",
  "womens-college-basketball": "basketball",
  mlb: "baseball",
  nhl: "hockey",
};

async function fetchTeamSchedule(feed: { sport: string; league: string; teamId: string; label: string }) {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${feed.sport}/${feed.league}/teams/${feed.teamId}/schedule`,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
      },
    }
  );
  if (!res.ok) throw new Error("upstream status " + res.status);
  const data = await res.json();
  const events: any[] = data?.events || [];

  const games: GameSummary[] = events.map((ev: any) => {
    const comp = ev.competitions?.[0];
    const status = comp?.status?.type || {};
    const competitors: any[] = comp?.competitors || [];
    const self = competitors.find((c: any) => String(c.team?.id) === String(feed.teamId));
    const opp = competitors.find((c: any) => String(c.team?.id) !== String(feed.teamId));
    return {
      date: ev.date,
      completed: !!status.completed,
      statusText: status.shortDetail || status.description || "",
      opponent: opp?.team?.displayName || "TBD",
      homeAway: self?.homeAway || "",
      teamScore: self?.score ?? null,
      oppScore: opp?.score ?? null,
      win: typeof self?.winner === "boolean" ? self.winner : null,
    };
  });

  const now = Date.now();
  const past = games.filter((g) => g.completed);
  const upcoming = games.filter((g) => !g.completed && new Date(g.date).getTime() >= now - 86400000);

  return {
    label: feed.label,
    lastResult: past.length ? past[past.length - 1] : null,
    nextGame: upcoming.length ? upcoming[0] : null,
    note: games.length ? undefined : "No scheduled games found (likely off-season).",
  };
}

// ESPN's own atp/wta scoreboard endpoints sometimes mislabel a joint tournament (e.g. the
// Cincinnati Open, held as one combined ATP+WTA event) — both the "atp" and "wta" queries
// can come back tagged with a "Men's Singles" grouping, which would make the WTA panel just
// show a duplicate of the men's draw under the women's header. Each grouping carries its own
// slug ("mens-singles" / "womens-singles" / "-doubles" variants), independent of which tour
// endpoint was requested, so cross-checking that slug against the requested tour catches the
// mismatch: a wrong-gender grouping is dropped instead of trusted, and a tournament left with
// zero matches after that is dropped entirely — an honest "no tournaments" instead of
// silently showing the wrong players. (Mirrors the same fix applied client-side in
// espnTennis() across the site's HTML — this function isn't currently called by any page,
// but is kept correct in case it's revived.)
const TENNIS_GENDER_PREFIX: Record<string, string> = { atp: "mens-", wta: "womens-" };

async function fetchTennis(tour: "atp" | "wta") {
  const wantPrefix = TENNIS_GENDER_PREFIX[tour];
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
    },
  });
  if (!res.ok) throw new Error("upstream status " + res.status);
  const data = await res.json();
  const events: any[] = data?.events || [];

  const tournaments = events
    .slice(0, 3)
    .map((ev: any) => {
      const matches: any[] = [];
      const groupings: any[] = ev.groupings || [];
      for (const g of groupings) {
        const slug: string = g.grouping?.slug || "";
        if (slug && wantPrefix && slug.indexOf(wantPrefix) !== 0) continue; // wrong-gender grouping — skip
        const comps: any[] = g.competitions || [];
        for (const c of comps.slice(0, 4)) {
          const a = c.competitors?.[0];
          const b = c.competitors?.[1];
          matches.push({
            round: c.round?.displayName || "",
            status: c.status?.type?.description || "",
            player1: a?.athlete?.displayName || "TBD",
            player2: b?.athlete?.displayName || "TBD",
          });
        }
      }
      return { name: ev.name, matches };
    })
    .filter((t: any) => t.matches.length > 0);

  return {
    tour: tour.toUpperCase(),
    tournaments,
    note: tournaments.length ? undefined : "No tournaments currently in progress.",
  };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const feed = url.searchParams.get("feed") || "all";

  try {
    if (feed === "all") {
      const teamKeys = Object.keys(TEAM_FEEDS);
      const [teamResults, atp, wta] = await Promise.all([
        Promise.all(
          teamKeys.map((k) =>
            fetchTeamSchedule(TEAM_FEEDS[k]).catch(() => ({ label: TEAM_FEEDS[k].label, lastResult: null, nextGame: null, note: "Unavailable" }))
          )
        ),
        fetchTennis("atp").catch(() => ({ tour: "ATP", tournaments: [], note: "Unavailable" })),
        fetchTennis("wta").catch(() => ({ tour: "WTA", tournaments: [], note: "Unavailable" })),
      ]);
      const teams: Record<string, any> = {};
      teamKeys.forEach((k, i) => (teams[k] = teamResults[i]));
      return new Response(JSON.stringify({ teams, tennis: { atp, wta }, updated: new Date().toISOString() }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
      });
    }

    if (feed === "custom") {
      let specs: any[] = [];
      try {
        specs = JSON.parse(url.searchParams.get("specs") || "[]");
      } catch {
        specs = [];
      }
      if (!Array.isArray(specs)) specs = [];
      // Cap and validate — each spec must name an allowed sport/league pair and a
      // numeric-looking team id; anything else is dropped rather than fetched.
      const clean = specs
        .slice(0, 12)
        .filter(
          (s) =>
            s &&
            typeof s.league === "string" &&
            ALLOWED_LEAGUES[s.league] === s.sport &&
            typeof s.teamId === "string" &&
            /^\d+$/.test(s.teamId) &&
            typeof s.label === "string" &&
            s.label.length > 0 &&
            s.label.length <= 60
        )
        .map((s) => ({ sport: s.sport, league: s.league, teamId: s.teamId, label: s.label.slice(0, 60) }));

      const [teamResults, atp, wta] = await Promise.all([
        Promise.all(
          clean.map((spec) =>
            fetchTeamSchedule(spec).catch(() => ({ label: spec.label, lastResult: null, nextGame: null, note: "Unavailable" }))
          )
        ),
        fetchTennis("atp").catch(() => ({ tour: "ATP", tournaments: [], note: "Unavailable" })),
        fetchTennis("wta").catch(() => ({ tour: "WTA", tournaments: [], note: "Unavailable" })),
      ]);
      const teams: Record<string, any> = {};
      clean.forEach((spec, i) => (teams[spec.league + ":" + spec.teamId + ":" + i] = teamResults[i]));
      return new Response(JSON.stringify({ teams, tennis: { atp, wta }, updated: new Date().toISOString() }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
      });
    }

    if (feed === "tennis-atp" || feed === "tennis-wta") {
      const tour = feed === "tennis-atp" ? "atp" : "wta";
      const result = await fetchTennis(tour);
      return new Response(JSON.stringify({ ...result, updated: new Date().toISOString() }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
      });
    }

    const teamFeed = TEAM_FEEDS[feed];
    if (!teamFeed) {
      return new Response(JSON.stringify({ error: "unknown_feed", known: [...Object.keys(TEAM_FEEDS), "tennis-atp", "tennis-wta", "all"] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const result = await fetchTeamSchedule(teamFeed);
    return new Response(JSON.stringify({ ...result, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};

export const config: Config = { path: "/api/sports" };
