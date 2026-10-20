import type { Config } from "@netlify/functions";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
  image: string;
  sourceLabel?: string;
}

interface FeedConfig {
  name: string;
  url: string;
}

// Reuters and AP publish no RSS feeds, and CNN's legacy feeds stopped updating in 2023,
// so those three come through Google News RSS filtered to the outlet's own domain
// (last 2 days). Headlines arrive as "Title - Outlet" and links go via news.google.com.
function gnews(name: string, site: string, topic = ""): FeedConfig {
  const q = encodeURIComponent(`site:${site}${topic ? " " + topic : ""} when:2d`);
  return { name, url: `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en` };
}
const REUTERS = (t = "") => gnews("Reuters", "reuters.com", t);
const AP = (t = "") => gnews("AP", "apnews.com", t);
const CNN = (t = "") => gnews("CNN", "cnn.com", t);

// Each category now blends 2-3 outlets instead of pulling from a single source.
// Picks lean mainstream/centrist-to-center-left-or-right, deliberately avoiding
// Fox News and fringe/conspiracy outlets, per the request to keep those out.
const SOURCES: Record<string, FeedConfig[]> = {
  "top-stories": [
    { name: "BBC", url: "http://feeds.bbci.co.uk/news/rss.xml" },
    { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
    { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    REUTERS(),
    AP(),
    CNN(),
  ],
  "us-politics": [
    { name: "HuffPost", url: "https://www.huffpost.com/section/politics/feed" },
    { name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml" },
    { name: "The Hill", url: "https://thehill.com/feed/" },
    REUTERS("politics"),
    AP("politics"),
    CNN("politics"),
  ],
  "world-politics": [
    { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
    { name: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
    { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    REUTERS("world"),
    AP("world news"),
    CNN("world"),
  ],
  economics: [
    { name: "BBC Business", url: "http://feeds.bbci.co.uk/news/business/rss.xml" },
    { name: "NPR Business", url: "https://feeds.npr.org/1006/rss.xml" },
    REUTERS("economy"),
    AP("economy business"),
    CNN("business economy"),
  ],
  "apple-tech": [
    { name: "9to5Mac", url: "https://9to5mac.com/feed/" },
    { name: "MacRumors", url: "http://feeds.macrumors.com/MacRumors-Front" },
    { name: "AppleInsider", url: "https://appleinsider.com/rss/news/" },
  ],
  "ai-tech": [
    { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
    { name: "NPR Technology", url: "https://feeds.npr.org/1019/rss.xml" },
    REUTERS("artificial intelligence"),
    AP("artificial intelligence"),
  ],
  "general-tech-science": [
    { name: "Ars Technica", url: "http://feeds.arstechnica.com/arstechnica/index" },
    { name: "NPR Technology", url: "https://feeds.npr.org/1019/rss.xml" },
    REUTERS("science technology"),
    AP("science technology"),
  ],
  "health-medicine": [
    { name: "BBC Health", url: "http://feeds.bbci.co.uk/news/health/rss.xml" },
    { name: "NPR Health", url: "https://feeds.npr.org/1128/rss.xml" },
    { name: "STAT News", url: "https://www.statnews.com/feed/" },
    REUTERS("health"),
    AP("health"),
    CNN("health"),
  ],
  canada: [
    { name: "Global News", url: "https://globalnews.ca/feed/" },
    { name: "CTV News", url: "https://www.ctvnews.ca/rss/ctvnews-ca-top-stories-public-rss-1.822009" },
    REUTERS("Canada"),
    AP("Canada"),
  ],
  quebec: [{ name: "Global News Montreal", url: "https://globalnews.ca/montreal/feed/" }],
  entertainment: [
    { name: "BBC Entertainment", url: "http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml" },
    { name: "NPR Culture", url: "https://feeds.npr.org/1008/rss.xml" },
    { name: "HuffPost", url: "https://www.huffpost.com/section/entertainment/feed" },
    AP("entertainment"),
    CNN("entertainment"),
  ],

  // French Canadian console (/fr/) — same 11 categories. La Presse (Quebec) covers most
  // categories directly; Le Monde, Le Figaro and France Info fill in extra breadth where
  // a second reliable French-language RSS feed exists.
  "fr-top-stories": [
    { name: "La Presse", url: "https://www.lapresse.ca/actualites/rss" },
    { name: "Le Figaro", url: "https://www.lefigaro.fr/rss/figaro_actualites.xml" },
  ],
  "fr-us-politics": [{ name: "La Presse — États-Unis", url: "https://www.lapresse.ca/international/etats-unis/rss" }],
  "fr-world-politics": [
    { name: "Le Monde", url: "https://www.lemonde.fr/international/rss_full.xml" },
    { name: "France Info", url: "https://www.francetvinfo.fr/titres.rss" },
  ],
  "fr-economics": [
    { name: "La Presse — Économie", url: "https://www.lapresse.ca/affaires/economie/rss" },
    { name: "Le Figaro Économie", url: "https://www.lefigaro.fr/rss/figaro_economie.xml" },
  ],
  "fr-apple-tech": [{ name: "MacGeneration", url: "https://www.macg.co/rss" }],
  "fr-ai-tech": [{ name: "Numerama", url: "https://www.numerama.com/feed/" }],
  "fr-general-tech-science": [{ name: "La Presse — Sciences", url: "https://www.lapresse.ca/actualites/sciences/rss" }],
  "fr-health-medicine": [{ name: "La Presse — Santé", url: "https://www.lapresse.ca/actualites/sante/rss" }],
  "fr-canada": [{ name: "La Presse — National", url: "https://www.lapresse.ca/actualites/national/rss" }],
  "fr-quebec": [{ name: "La Presse — Régional", url: "https://www.lapresse.ca/actualites/regional/rss" }],
  "fr-entertainment": [
    { name: "La Presse — Cinéma", url: "https://www.lapresse.ca/cinema/rss" },
    { name: "Le Figaro Culture", url: "https://www.lefigaro.fr/rss/figaro_culture.xml" },
  ],
};

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  let val = m[1].trim();
  const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) val = cdata[1];
  return val;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function parseItems(xml: string, max = 12): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of matches.slice(0, max)) {
    const title = decodeEntities(stripHtml(extractTag(block, "title")));
    const link = decodeEntities(extractTag(block, "link")).trim();
    const pubDate = extractTag(block, "pubDate") || extractTag(block, "dc:date") || "";
    let desc = extractTag(block, "description") || extractTag(block, "content:encoded") || "";
    desc = decodeEntities(stripHtml(desc));
    if (desc.length > 180) desc = desc.slice(0, 177) + "…";

    let image = "";
    const enclosure = block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i);
    const media =
      block.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i) ||
      block.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i);
    const imgTag = block.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (enclosure) image = enclosure[1];
    else if (media) image = media[1];
    else if (imgTag) image = imgTag[1];

    if (title && link) items.push({ title, link, pubDate, snippet: desc, image });
  }
  return items;
}

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
  });
  if (!res.ok) throw new Error("upstream status " + res.status);
  const xml = await res.text();
  const isGoogle = feed.url.includes("news.google.com");
  return parseItems(xml, 12).map((it) => ({
    ...it,
    ...(isGoogle ? { title: it.title.replace(/\s+-\s+[^-]{2,40}$/, ""), snippet: "" } : {}),
    sourceLabel: feed.name,
  }));
}

// Blend multiple outlets by alternating between them (source A's newest, source B's
// newest, source C's newest, then source A's 2nd-newest, ...) rather than a flat
// recency sort, so one prolific outlet can't crowd out the others in the mix.
function interleave(bySource: NewsItem[][], limit: number): NewsItem[] {
  const out: NewsItem[] = [];
  let round = 0;
  while (out.length < limit) {
    let addedAny = false;
    for (const items of bySource) {
      if (round < items.length) {
        out.push(items[round]);
        addedAny = true;
        if (out.length >= limit) break;
      }
    }
    if (!addedAny) break;
    round++;
  }
  return out;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("source") || "us-politics";
  const feeds = SOURCES[key];
  if (!feeds) {
    return new Response(JSON.stringify({ error: "unknown_source", known: Object.keys(SOURCES) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const bySource = results
    .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((items) => items.length > 0);

  if (!bySource.length) {
    return new Response(JSON.stringify({ error: "fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const items = interleave(bySource, 21);
  const activeNames = feeds
    .filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<NewsItem[]>).value.length > 0)
    .map((f) => f.name);

  return new Response(JSON.stringify({ source: key, name: activeNames.join(", "), items, updated: new Date().toISOString() }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
};

export const config: Config = { path: "/api/news" };
