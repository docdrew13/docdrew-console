import type { Config } from "@netlify/functions";

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", sbquo: "‚",
  rdquo: "”", ldquo: "“", bdquo: "„",
  ndash: "–", mdash: "—", hellip: "…",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  agrave: "à", acirc: "â", auml: "ä", aring: "å",
  ocirc: "ô", ouml: "ö", ograve: "ò",
  ucirc: "û", uuml: "ü", ugrave: "ù",
  ccedil: "ç", icirc: "î", iuml: "ï", igrave: "ì",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
  oelig: "œ", OElig: "Œ", aelig: "æ", AElig: "Æ",
  szlig: "ß", ntilde: "ñ", Ntilde: "Ñ",
  copy: "©", reg: "®", trade: "™",
  deg: "°", middot: "·", laquo: "«", raquo: "»",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    );
}

// Raw channel IDs (UCxxxxxxxxxxxxxxxxxxxxxxxx) work directly against the RSS feed
// below, but almost nobody has theirs memorized — people paste a channel URL or an
// @handle instead. Resolve either of those to the canonical channel ID first by
// fetching the public channel page and pulling it out of the page metadata.
function looksLikeChannelId(s: string): boolean {
  return /^UC[\w-]{22}$/.test(s);
}

async function resolveChannelId(input: string): Promise<string> {
  if (looksLikeChannelId(input)) return input;

  let pageUrl: string;
  if (/^https?:\/\//i.test(input)) {
    pageUrl = input;
  } else if (input.startsWith("@")) {
    pageUrl = "https://www.youtube.com/" + input;
  } else if (input.startsWith("UC")) {
    // close to a channel id but didn't match the strict pattern above — try it raw
    return input;
  } else {
    pageUrl = "https://www.youtube.com/@" + input;
  }

  const res = await fetch(pageUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
  });
  if (!res.ok) throw new Error("channel_page_status_" + res.status);
  const html = await res.text();

  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/i);
  if (canonical) return canonical[1];
  const embedded = html.match(/"channelId":"(UC[\w-]{22})"/);
  if (embedded) return embedded[1];

  throw new Error("channel_id_not_found");
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const channelInput = url.searchParams.get("channel");
  if (!channelInput) {
    return new Response(JSON.stringify({ error: "missing_channel" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const channel = await resolveChannelId(channelInput.trim());
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel)}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const xml = await res.text();

    const entryMatch = xml.match(/<entry>[\s\S]*?<\/entry>/);
    if (!entryMatch) throw new Error("no_entries");
    const entry = entryMatch[0];

    const videoId = extractTag(entry, "yt:videoId");
    const title = decodeEntities(extractTag(entry, "title"));
    const published = extractTag(entry, "published");
    const authorNameMatch = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i);
    const author = authorNameMatch ? decodeEntities(authorNameMatch[1].trim()) : "";

    if (!videoId) throw new Error("no_video_id");

    return new Response(
      JSON.stringify({
        channel,
        videoId,
        title,
        author,
        published,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=1800" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/youtube" };
