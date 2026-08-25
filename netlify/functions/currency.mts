import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "USD").toUpperCase();
  const to = (url.searchParams.get("to") || "CAD").toUpperCase();
  const amount = url.searchParams.get("amount") || "1";

  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?amount=${encodeURIComponent(amount)}&from=${from}&to=${to}`
    );
    if (!res.ok) throw new Error("frankfurter status " + res.status);
    const data = await res.json();
    return new Response(JSON.stringify({ ...data, updated: new Date().toISOString() }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=1800" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/currency" };
