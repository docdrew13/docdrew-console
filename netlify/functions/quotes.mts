import type { Config } from "@netlify/functions";

interface Quote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  error?: boolean;
}

async function fetchYahoo(symbol: string): Promise<Quote> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    { headers: { "user-agent": "Mozilla/5.0" } }
  );
  if (!res.ok) throw new Error("yahoo status " + res.status);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("yahoo: no meta");
  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  if (typeof price !== "number" || typeof prevClose !== "number") throw new Error("yahoo: missing fields");
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    price,
    previousClose: prevClose,
    change,
    changePercent,
    currency: meta.currency || "",
  };
}

function mapToStooq(symbol: string): string {
  if (symbol.includes("-USD")) return symbol.replace("-USD", "usd").toLowerCase();
  if (symbol.includes(".")) return symbol.toLowerCase();
  return symbol.toLowerCase() + ".us";
}

async function fetchStooq(symbol: string): Promise<Quote> {
  const stooqSymbol = mapToStooq(symbol);
  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`);
  if (!res.ok) throw new Error("stooq status " + res.status);
  const text = await res.text();
  const rows = text.trim().split("\n").filter(Boolean);
  if (rows.length < 3) throw new Error("stooq: insufficient rows");
  const last = rows[rows.length - 1].split(",");
  const prev = rows[rows.length - 2].split(",");
  const price = parseFloat(last[4]);
  const prevClose = parseFloat(prev[4]);
  if (isNaN(price) || isNaN(prevClose)) throw new Error("stooq: bad numbers");
  const change = price - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  return { symbol, name: symbol, price, previousClose: prevClose, change, changePercent, currency: "" };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols") || "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  if (!symbols.length) {
    return new Response(JSON.stringify({ quotes: [] }), { headers: { "content-type": "application/json" } });
  }

  const settled = await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        return await fetchYahoo(sym);
      } catch {
        return await fetchStooq(sym);
      }
    })
  );

  const quotes: Quote[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { symbol: symbols[i], name: symbols[i], price: NaN, previousClose: NaN, change: NaN, changePercent: NaN, currency: "", error: true }
  );

  return new Response(JSON.stringify({ quotes, updated: new Date().toISOString() }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
};

export const config: Config = { path: "/api/quotes" };
