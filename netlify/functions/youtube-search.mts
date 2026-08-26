import type { Config } from "@netlify/functions";

// Free, keyless channel search — the "official" way (YouTube Data API's
// search.list) needs an API key and a Google Cloud project, which is more
// setup than this personal console wants to ask of anyone. Instead, this
// scrapes YouTube's own public search results page the same way youtube.mts
// already resolves a channel URL/@handle to a channel ID: pull the embedded
// ytInitialData blob out of the HTML and read it directly.
//
// ytInitialData's shape around search results shifts periodically (locale
// experiments, gradual redesigns), so rather than hardcoding one nested path
// to the results list, this walks the whole parsed tree for any object keyed
// "channelRenderer" — the same recursive-key approach real-world YouTube
// scrapers use for "$..channelRenderer", since it survives most structural
// reshuffling as long as the renderer's own field names stay put.

interface ChannelResult {
  channelId: string;
  name: string;
  thumbnail: string;
  subscribers: string;
  description: string;
}

const MAX_RESULTS = 8;

// String-aware brace matching — a naive non-greedy regex for the embedded
// JSON blob breaks the moment a channel description contains a literal "{"
// or "}", which does happen. This walks the raw text starting at the first
// "{" after the marker, tracking whether we're inside a quoted string (and
// respecting escaped quotes) so only structural braces are counted.
function extractJsonAfter(html: string, marker: string): any {
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error("marker_not_found");
  const start = html.indexOf("{", idx);
  if (start === -1) throw new Error("json_start_not_found");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error("json_end_not_found");
}

function findAllByKey(obj: any, key: string, out: any[] = []): any[] {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const item of obj) findAllByKey(item, key, out);
    return out;
  }
  for (const k of Object.keys(obj)) {
    if (k === key) out.push(obj[k]);
    else findAllByKey(obj[k], key, out);
  }
  return out;
}

function bestThumbnail(renderer: any): string {
  const thumbs = renderer?.thumbnail?.thumbnails;
  if (!Array.isArray(thumbs) || !thumbs.length) return "";
  const pick = thumbs[thumbs.length - 1]; // largest is listed last
  let url = pick?.url || "";
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "missing_query" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://www.youtube.com/results?search_query=" + encodeURIComponent(query), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const html = await res.text();

    const data = extractJsonAfter(html, "var ytInitialData");
    const renderers = findAllByKey(data, "channelRenderer");

    const seen = new Set<string>();
    const results: ChannelResult[] = [];
    for (const r of renderers) {
      const channelId: string = r?.channelId || "";
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);

      const name: string = r?.title?.simpleText || r?.title?.runs?.[0]?.text || "";
      if (!name) continue;

      const descRuns = r?.descriptionSnippet?.runs;
      const description: string = Array.isArray(descRuns) ? descRuns.map((d: any) => d?.text || "").join("") : "";

      results.push({
        channelId,
        name,
        thumbnail: bestThumbnail(r),
        subscribers: r?.subscriberCountText?.simpleText || "",
        description,
      });
      if (results.length >= MAX_RESULTS) break;
    }

    return new Response(
      JSON.stringify({ query, results, updated: new Date().toISOString() }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=1800" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/youtube-search" };
