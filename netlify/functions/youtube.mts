import type { Config } from "@netlify/functions";

function extractTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  if (!channel) {
    return new Response(JSON.stringify({ error: "missing_channel" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
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
