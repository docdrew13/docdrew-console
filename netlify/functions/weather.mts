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

    const wxPromise = fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,precipitation,snowfall,cloud_cover,is_day` +
        `&hourly=temperature_2m,precipitation_probability,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,snowfall_sum` +
        `&forecast_days=6&timezone=auto&temperature_unit=celsius&wind_speed_unit=kmh`
    );
    // air quality is a separate Open-Meteo service — fetched in parallel, and allowed to fail
    // without taking down the rest of the report (some remote/ocean coordinates have no AQ data).
    const aqPromise = fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
        `&current=us_aqi,pm2_5,pm10,ozone&timezone=auto`
    ).catch(() => null);

    const [wxRes, aqRes] = await Promise.all([wxPromise, aqPromise]);
    if (!wxRes.ok) throw new Error("forecast status " + wxRes.status);
    const wx = await wxRes.json();

    let airQuality: any = null;
    if (aqRes && aqRes.ok) {
      try {
        const aq = await aqRes.json();
        const aqi = aq?.current?.us_aqi;
        if (typeof aqi === "number") {
          let category = "Unknown";
          if (aqi <= 50) category = "Good";
          else if (aqi <= 100) category = "Moderate";
          else if (aqi <= 150) category = "Unhealthy (Sensitive)";
          else if (aqi <= 200) category = "Unhealthy";
          else if (aqi <= 300) category = "Very Unhealthy";
          else category = "Hazardous";
          airQuality = {
            aqi,
            category,
            pm25: aq.current?.pm2_5,
            pm10: aq.current?.pm10,
            ozone: aq.current?.ozone,
          };
        }
      } catch {
        airQuality = null;
      }
    }

    // find the hourly index nearest "now" so we can hand back the next ~12 hours only
    let startIdx = 0;
    const hourlyTimes: string[] = wx.hourly?.time || [];
    if (wx.current?.time) {
      const nowMs = new Date(wx.current.time).getTime();
      const found = hourlyTimes.findIndex((t: string) => new Date(t).getTime() >= nowMs);
      if (found >= 0) startIdx = found;
    }
    const hourly = hourlyTimes.slice(startIdx, startIdx + 12).map((t: string, i: number) => ({
      time: t,
      temp: wx.hourly?.temperature_2m?.[startIdx + i],
      precipProb: wx.hourly?.precipitation_probability?.[startIdx + i],
      code: wx.hourly?.weather_code?.[startIdx + i],
    }));

    const dailyTimes: string[] = wx.daily?.time || [];
    const daily = dailyTimes.map((d: string, i: number) => ({
      date: d,
      max: wx.daily?.temperature_2m_max?.[i],
      min: wx.daily?.temperature_2m_min?.[i],
      code: wx.daily?.weather_code?.[i],
      sunrise: wx.daily?.sunrise?.[i],
      sunset: wx.daily?.sunset?.[i],
      uvMax: wx.daily?.uv_index_max?.[i],
      precipSum: wx.daily?.precipitation_sum?.[i],
      precipProbMax: wx.daily?.precipitation_probability_max?.[i],
      windMax: wx.daily?.wind_speed_10m_max?.[i],
    }));

    return new Response(
      JSON.stringify({
        place: { name, admin1, country, latitude, longitude },
        current: wx.current,
        today: {
          max: wx.daily?.temperature_2m_max?.[0],
          min: wx.daily?.temperature_2m_min?.[0],
          code: wx.daily?.weather_code?.[0],
        },
        hourly,
        daily,
        airQuality,
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
