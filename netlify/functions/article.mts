import type { Config } from "@netlify/functions";

function stripTag(html: string, tag: string): string {
  return html.replace(new RegExp("<" + tag + "[^>]*>[\\s\\S]*?<\\/" + tag + ">", "gi"), " ");
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
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—");
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return new Response(JSON.stringify({ error: "missing_url" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const res = await fetch(target, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error("upstream status " + res.status);
    let html = await res.text();

    // Strip non-content noise before extracting readable text.
    html = stripTag(html, "script");
    html = stripTag(html, "style");
    html = stripTag(html, "noscript");
    html = stripTag(html, "svg");
    html = stripTag(html, "nav");
    html = stripTag(html, "footer");
    html = stripTag(html, "header");
    html = stripTag(html, "aside");
    html = stripTag(html, "form");

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = ogTitle
      ? decodeEntities(stripHtml(ogTitle[1])).trim()
      : titleTag
      ? decodeEntities(stripHtml(titleTag[1])).trim()
      : "";

    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const image = ogImage ? ogImage[1] : "";

    // Poor-man's readability pass: pull paragraph-level text, drop short boilerplate lines.
    const pMatches = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    const seen = new Set<string>();
    const paragraphs: string[] = [];
    for (const block of pMatches) {
      const text = decodeEntities(stripHtml(block));
      if (text.length < 40) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      paragraphs.push(text);
      if (paragraphs.length >= 40) break;
    }

    if (!paragraphs.length) throw new Error("no_readable_content");

    return new Response(JSON.stringify({ title, image, paragraphs }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=900" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/article" };
