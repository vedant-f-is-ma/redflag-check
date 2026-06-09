// GET /api/v1/zone-check?address=<str>
// GET /api/v1/zone-check?lat=<num>&lng=<num>
//
// Returns: { input, location, in_red_flag_zone, alerts[], forecast, action_checklist, links, sources, generated_at }
//
// CORS-enabled, no auth required. Cached for 60s edge-side.

import {
  geocodeAddress,
  fetchAlertsAtPoint,
  fetchForecastSummary,
  buildActionChecklist,
  genasysUrl,
  jsonResponse,
  errorResponse,
  ALAMEDA_AC_ALERT_SIGNUP,
  WATCH_DUTY_URL,
  AIRNOW_FIRE_MAP,
} from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");

  let lat: number;
  let lng: number;
  let matched_address: string | undefined;
  let zip: string | undefined;

  if (address) {
    const geo = await geocodeAddress(address);
    if (!geo) return errorResponse("Could not geocode address. Try including the ZIP code or city.", 422);
    lat = geo.lat;
    lng = geo.lng;
    matched_address = geo.matched_address;
    zip = geo.zip;
  } else if (latParam && lngParam) {
    lat = parseFloat(latParam);
    lng = parseFloat(lngParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return errorResponse("lat and lng must be valid numbers.", 422);
    }
  } else {
    return errorResponse("Provide either ?address=... or ?lat=...&lng=... (URL-encoded).", 400);
  }

  // Fetch alerts + forecast in parallel
  const [alerts, forecast] = await Promise.all([
    fetchAlertsAtPoint(lat, lng),
    fetchForecastSummary(lat, lng),
  ]);

  // Find the Red Flag Warning specifically (the most important question)
  const redFlagAlerts = alerts.filter((a) => a.event === "Red Flag Warning");
  const inZone = redFlagAlerts.length > 0;

  // Heuristic: is the location in or near the East Bay Hills WUI?
  // Bbox roughly: lat 37.4-37.9, lng -122.35 to -121.85
  // The hills strip is east of -122.25 and west of -121.95 in lat range 37.55-37.85
  const isHillsAdjacent =
    lat >= 37.5 && lat <= 37.9 && lng >= -122.3 && lng <= -121.85 && !inZone;

  const checklist = buildActionChecklist(inZone, isHillsAdjacent);

  return jsonResponse({
    input: {
      address: address ?? null,
      lat_requested: latParam ? parseFloat(latParam) : null,
      lng_requested: lngParam ? parseFloat(lngParam) : null,
    },
    location: {
      lat,
      lng,
      matched_address: matched_address ?? null,
      zip: zip ?? null,
    },
    in_red_flag_zone: inZone,
    alerts: redFlagAlerts,
    other_alerts: alerts.filter((a) => a.event !== "Red Flag Warning"),
    forecast: forecast,
    action_checklist: checklist,
    links: {
      genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
      official_ac_alert_signup: ALAMEDA_AC_ALERT_SIGNUP,
      watch_duty: WATCH_DUTY_URL,
      airnow_fire_map: AIRNOW_FIRE_MAP,
    },
    sources: [
      "NWS api.weather.gov (Red Flag Warning + hourly forecast)",
      "US Census geocoder (address → lat/lng)",
      "Genasys Protect (official Alameda County evacuation zones)",
    ],
    disclaimer:
      "Informational only. This is NOT an official emergency service. For official alerts, sign up at AC Alert. For active incidents, see Watch Duty. In case of fire, call 911.",
    generated_at: new Date().toISOString(),
  });
}
