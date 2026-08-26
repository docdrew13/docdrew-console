import type { Config } from "@netlify/functions";

// Mid-latitude (~45°N, e.g. Montreal/Granby) visibility heuristic.
// Kp is a 0-9 planetary geomagnetic activity index; roughly, the aurora's
// equatorward boundary creeps south as Kp rises. At ~45°N you need a
// moderately disturbed magnetosphere to have a shot at seeing it.
function visibilityHint(kp: number): string {
  if (kp >= 8) return "Aurora likely overhead — go look now";
  if (kp >= 7) return "Aurora possible low on the northern horizon";
  if (kp >= 6) return "Slight chance on the northern horizon, dark clear skies needed";
  if (kp >= 5) return "Unlikely at this latitude tonight";
  return "Quiet — no aurora expected at this latitude";
}

export default async (req: Request) => {
  try {
    const res = await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < 2) throw new Error("unexpected_shape");

    // first row is a header-ish/oldest entry depending on feed; take the tail as recent history
    const recent = rows.slice(-9).filter((r: any) => r && typeof r.Kp !== "undefined" && r.Kp !== "Kp");
    const history = recent.map((r: any) => ({
      time: r.time_tag,
      kp: typeof r.Kp === "string" ? parseFloat(r.Kp) : r.Kp,
    })).filter((r: any) => !isNaN(r.kp));

    if (!history.length) throw new Error("no_history");
    const latest = history[history.length - 1];

    return new Response(
      JSON.stringify({
        kp: latest.kp,
        time: latest.time,
        hint: visibilityHint(latest.kp),
        history,
        updated: new Date().toISOString(),
      }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=900" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/aurora" };
