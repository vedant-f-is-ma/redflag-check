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
  fetchActiveRedFlagPolygons,
  classifyVerdict,
  buildActionChecklist,
  buildStaticMapUrls,
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

  // Fetch alerts at point, the full state RFW polygon set (for distance math), and forecast in parallel
  const [pointAlerts, statePolygons, forecast] = await Promise.all([
    fetchAlertsAtPoint(lat, lng),
    fetchActiveRedFlagPolygons("CA"),
    fetchForecastSummary(lat, lng),
  ]);

  // Find Red Flag Warning alerts (legacy field for backward compat)
  const redFlagAlerts = pointAlerts.filter((a) => a.event === "Red Flag Warning");

  // NEW: 4-state verdict using polygon geometry + wind vector
  const verdict = classifyVerdict(lat, lng, statePolygons, forecast);
  const inZone = verdict.state === "in_zone";

  // Backward-compatible category mapping for the existing action checklist
  const checklistCategory: "in_zone" | "adjacent" | "out_of_zone" =
    verdict.state === "in_zone" ? "in_zone"
    : (verdict.state === "downwind_threat" || verdict.state === "adjacent") ? "adjacent"
    : "out_of_zone";
  const checklist = buildActionChecklist(
    checklistCategory === "in_zone",
    checklistCategory === "adjacent"
  );

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
    // NEW: the 4-state verdict — clients should prefer this over `in_red_flag_zone` for UI rendering
    verdict,
    // Ordered static-map image URLs (real basemap + polygon overlay) the client can
    // upgrade to from the SVG. Empty unless a map provider key is configured.
    map_image_urls: buildStaticMapUrls(lat, lng, verdict.nearest_polygon),
    // Legacy fields preserved for any existing integrators
    in_red_flag_zone: inZone,
    alerts: redFlagAlerts,
    other_alerts: pointAlerts.filter((a) => a.event !== "Red Flag Warning"),
    forecast: forecast,
    action_checklist: checklist,
    links: {
      genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
      official_ac_alert_signup: ALAMEDA_AC_ALERT_SIGNUP,
      watch_duty: WATCH_DUTY_URL,
      airnow_fire_map: AIRNOW_FIRE_MAP,
    },
    sources: [
      "NWS api.weather.gov (Red Flag Warning polygons + hourly wind forecast)",
      "US Census geocoder (address → lat/lng)",
      "Genasys Protect (official Alameda County evacuation zones)",
    ],
    disclaimer:
      "Informational only. The downwind-threat reading is a flat-earth wind-line approximation; ridges and canyons change actual fire paths. Always heed official evacuation orders. For official alerts, sign up at AC Alert. In case of fire, call 911.",
    generated_at: new Date().toISOString(),
  });
}
