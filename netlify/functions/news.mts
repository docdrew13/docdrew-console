import type { Config } from "@netlify/functions";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  snippet: string;
  image: string;
}

const SOURCES: Record<string, { name: string; url: string }> = {
  "top-stories": { name: "BBC Top Stories", url: "http://feeds.bbci.co.uk/news/rss.xml" },
  "us-politics": { name: "HuffPost Politics", url: "https://www.huffpost.com/section/politics/feed" },
  "world-politics": { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml" },
  economics: { name: "BBC Business", url: "http://feeds.bbci.co.uk/news/business/rss.xml" },
  "apple-tech": { name: "9to5Mac", url: "https://9to5mac.com/feed/" },
  "ai-tech": { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  "general-tech-science": { name: "Ars Technica", url: "http://feeds.arstechnica.com/arstechnica/index" },
  "health-medicine": { name: "BBC Health", url: "http://feeds.bbci.co.uk/news/health/rss.xml" },
  canada: { name: "Global News", url: "https://globalnews.ca/feed/" },
  quebec: { name: "Global News Montreal", url: "https://globalnews.ca/montreal/feed/" },
  entertainment: { name: "BBC Entertainment", url: "http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml" },

  // French Canadian console (/fr/) — same 11 categories, Quebec + France sources.
  // La Presse (Quebec) covers most categories directly; Le Monde and MacGeneration
  // (both France-based) fill in world politics and Apple-specific tech.
  "fr-top-stories": { name: "La Presse — Actualités", url: "https://www.lapresse.ca/actualites/rss" },
  "fr-us-politics": { name: "La Presse — États-Unis", url: "https://www.lapresse.ca/international/etats-unis/rss" },
  "fr-world-politics": { name: "Le Monde — International", url: "https://www.lemonde.fr/international/rss_full.xml" },
  "fr-economics": { name: "La Presse — Économie", url: "https://www.lapresse.ca/affaires/economie/rss" },
  "fr-apple-tech": { name: "MacGeneration", url: "https://www.macg.co/rss" },
  "fr-ai-tech": { name: "Numerama", url: "https://www.numerama.com/feed/" },
  "fr-general-tech-science": { name: "La Presse — Sciences", url: "https://www.lapresse.ca/actualites/sciences/rss" },
  "fr-health-medicine": { name: "La Presse — Santé", url: "https://www.lapresse.ca/actualites/sante/rss" },
  "fr-canada": { name: "La Presse — National", url: "https://www.lapresse.ca/actualites/national/rss" },
  "fr-quebec": { name: "La Presse — Régional", url: "https://www.lapresse.ca/actualites/regional/rss" },
  "fr-entertainment": { name: "La Presse — Cinéma", url: "https://www.lapresse.ca/cinema/rss" },
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
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

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("source") || "us-politics";
  const src = SOURCES[key];
  if (!src) {
    return new Response(JSON.stringify({ error: "unknown_source", known: Object.keys(SOURCES) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const res = await fetch(src.url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocdrewConsole/1.0; +https://docdrew.ca)" },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    const xml = await res.text();
    const items = parseItems(xml, 12);
    return new Response(JSON.stringify({ source: key, name: src.name, items, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/news" };
