import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const url = new URL(req.url);
  const city = url.searchParams.get("city") || "Toronto";
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  try {
    let latitude: number, longitude: number, name = city, admin1 = "", country = "";

    if (lat && lon) {
      latitude = parseFloat(lat);
      longitude = parseFloat(lon);
    } else {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
      );
      if (!geoRes.ok) throw new Error("geocode status " + geoRes.status);
      const geo = await geoRes.json();
      const place = geo?.results?.[0];
      if (!place) {
        return new Response(JSON.stringify({ error: "not_found", city }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      latitude = place.latitude;
      longitude = place.longitude;
      name = place.name;
      admin1 = place.admin1 || "";
      country = place.country || "";
    }

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,cloud_cover,is_day` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
        `&timezone=auto&temperature_unit=celsius&wind_speed_unit=kmh`
    );
    if (!wxRes.ok) throw new Error("forecast status " + wxRes.status);
    const wx = await wxRes.json();

    return new Response(
      JSON.stringify({
        place: { name, admin1, country, latitude, longitude },
        current: wx.current,
        today: {
          max: wx.daily?.temperature_2m_max?.[0],
          min: wx.daily?.temperature_2m_min?.[0],
          code: wx.daily?.weather_code?.[0],
        },
        updated: new Date().toISOString(),
      }),
      { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "fetch_failed", message: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/weather" };
