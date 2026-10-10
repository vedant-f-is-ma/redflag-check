// GET /api/v1/autocomplete?text=<query>
//
// Proxies Geoapify address autocomplete and returns a simplified list of
// { formatted, lat, lng }. Used by the address field's typeahead.
//
// Optional lat/lng bias the results toward a point the CLIENT already knows about
// (the caller's last checked location). This used to be a hard-coded Bay Area
// proximity, which quietly mis-ranked partial queries everywhere else in the country
// — "123 Main St" surfaced Bay Area Main Streets to a user in Texas. With no bias
// supplied we send none and let Geoapify rank on relevance within the US.
// This is a typing CONVENIENCE, not emergency-critical: it returns an empty list on
// any failure (no key, upstream error, too-short query), and the client degrades to
// plain manual typing. Keeping the key server-side also avoids exposing it per keystroke.

import { jsonResponse, USER_AGENT } from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const text = (url.searchParams.get("text") || "").trim();
  if (text.length < 3) return jsonResponse({ suggestions: [] });

  // Bias point, if the client passed a usable one. Anything malformed or off-globe is
  // dropped rather than forwarded — a bad bias silently skews every suggestion.
  const bLat = parseFloat(url.searchParams.get("lat") || "");
  const bLng = parseFloat(url.searchParams.get("lng") || "");
  const hasBias =
    Number.isFinite(bLat) && Number.isFinite(bLng) &&
    Math.abs(bLat) <= 90 && Math.abs(bLng) <= 180;

  const key = (typeof process !== "undefined" && process.env && process.env.GEOAPIFY_API_KEY) || "";
  if (!key) return jsonResponse({ suggestions: [] });

  try {
    const g =
      `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}` +
      (hasBias ? `&bias=proximity:${bLng.toFixed(4)},${bLat.toFixed(4)}` : "") +
      `&filter=countrycode:us&limit=5&format=json&apiKey=${key}`;
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
