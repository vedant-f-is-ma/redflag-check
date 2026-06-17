// GET /api/v1/autocomplete?text=<query>
//
// Proxies Geoapify address autocomplete, biased to the Bay Area, and returns a
// simplified list of { formatted, lat, lng }. Used by the address field's typeahead.
// This is a typing CONVENIENCE, not emergency-critical: it returns an empty list on
// any failure (no key, upstream error, too-short query), and the client degrades to
// plain manual typing. Keeping the key server-side also avoids exposing it per keystroke.

import { jsonResponse, USER_AGENT } from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const text = (url.searchParams.get("text") || "").trim();
  if (text.length < 3) return jsonResponse({ suggestions: [] });

  const key = (typeof process !== "undefined" && process.env && process.env.GEOAPIFY_API_KEY) || "";
  if (!key) return jsonResponse({ suggestions: [] });

  try {
    const g =
      `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}` +
      `&bias=proximity:-122.2,37.8&filter=rect:-123.0,37.2,-121.6,38.2&limit=5&format=json&apiKey=${key}`;
    const res = await fetch(g, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return jsonResponse({ suggestions: [] });
    const data = (await res.json()) as any;
    const suggestions = (data?.results || [])
      .map((r: any) => ({ formatted: r.formatted, lat: r.lat, lng: r.lon }))
      .filter((s: any) => s.formatted && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    return jsonResponse({ suggestions });
  } catch {
    return jsonResponse({ suggestions: [] });
  }
}
