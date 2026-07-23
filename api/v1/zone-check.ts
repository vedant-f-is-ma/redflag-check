// GET /api/v1/zone-check?address=<str>
// GET /api/v1/zone-check?lat=<num>&lng=<num>
//
// Returns: { input, location, in_red_flag_zone, alerts[], forecast, action_checklist, links, sources, generated_at }
//
// CORS-enabled, no auth required. Cached for 60s edge-side.

import {
  geocodeAddress,
  reverseGeocode,
  fetchAlertsAtPoint,
  fetchForecastSummary,
  fetchActiveRedFlagPolygons,
  resolveAlertsToPolygons,
  fetchPyrecastData,
  classifyVerdict,
  buildActionChecklist,
  buildDataUnavailableChecklist,
  buildStaticMapUrls,
  genasysUrl,
  jsonResponse,
  errorResponse,
  LOCAL_ALERTS_URL,
  WATCH_DUTY_URL,
  AIRNOW_FIRE_MAP,
  type RedFlagPolygon,
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
  let state: string | undefined; // 2-letter state code, used to scope the out-of-zone regional fetch

  if (address) {
    const geo = await geocodeAddress(address);
    if (!geo) return errorResponse("Could not geocode address. Try including the ZIP code or city.", 422);
    lat = geo.lat;
    lng = geo.lng;
    matched_address = geo.matched_address;
    zip = geo.zip;
    state = geo.state;
  } else if (latParam && lngParam) {
    lat = parseFloat(latParam);
    lng = parseFloat(lngParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return errorResponse("lat and lng must be valid numbers.", 422);
    }
  } else {
    return errorResponse("Provide either ?address=... or ?lat=...&lng=... (URL-encoded).", 400);
  }

  // Fetch alerts at the point, the forecast, an optional reverse-geocoded label
  // (lat/lng path), and fire context — all in parallel. Which polygon set we need
  // (the point's OWN warnings vs the surrounding state) depends on the point-alert
  // result, so polygons are resolved in the step after.
  const [alertsRes, forecastRes, reverseInfo, pyrecast] = await Promise.all([
    fetchAlertsAtPoint(lat, lng),
    fetchForecastSummary(lat, lng),
    address ? Promise.resolve(null) : reverseGeocode(lat, lng),
    fetchPyrecastData(lat, lng),
  ]);
  if (!matched_address && reverseInfo) matched_address = reverseInfo.label;
  // For a raw lat/lng request the state comes from the reverse geocode — it scopes
  // the out-of-zone regional fetch so geolocation users keep adjacency/downwind.
  if (!state && reverseInfo?.state) state = reverseInfo.state;

  // Red Flag Warning alerts AT THE POINT. NWS returns only alerts whose zones
  // CONTAIN the point, so a non-empty result is the authoritative in_zone signal —
  // including zone-based (UGC-only) warnings that carry no inline polygon.
  // A FAILED point query is not an empty one: alertsRes.ok flows into the verdict's
  // availability so the failure degrades toward warning, never toward "safe".
  const pointAlerts = alertsRes.ok ? alertsRes.alerts : [];
  const redFlagAlerts = pointAlerts.filter((a) => a.event === "Red Flag Warning");
  const inZoneByPoint = redFlagAlerts.length > 0;

  // In-zone: resolve the point's own warnings to geometry (a handful of zones) so
  // the map can draw the actual warning area. Out-of-zone: pull the surrounding
  // state's warnings so we can still report the nearest one + downwind threat.
  let polygons: RedFlagPolygon[] = [];
  let polygonsOk: boolean;
  if (inZoneByPoint) {
    // Geometry only enriches an already-decided in_zone verdict (map, nearest edge);
    // resolution failures here must not — and cannot — degrade that verdict.
    polygons = await resolveAlertsToPolygons(redFlagAlerts);
    polygonsOk = true;
  } else if (state) {
    const regional = await fetchActiveRedFlagPolygons(state);
    polygons = regional.ok ? regional.polygons : [];
    // Partial resolution counts as failure: a warning that dropped out of the set
    // (or resolved at partial extent) could sit right next to this address, and
    // "nothing nearby" must never rest on data we know is missing.
    polygonsOk = regional.ok && regional.complete;
  } else {
    // No derivable state -> nearby warnings are UNKNOWN, not absent. Without this,
    // a reverse-geocode outage would let a "no warnings anywhere near you" verdict
    // ship on a polygon set that was never fetched.
    polygonsOk = false;
  }

  // 5-state verdict. The point query is authoritative for in_zone (forceInZone);
  // geometry enriches it; availability lets a would-be "safe" degrade to
  // data_unavailable instead of falsely reassuring when a source failed.
  const forecast = forecastRes.forecast;
  const verdict = classifyVerdict(lat, lng, polygons, forecast, inZoneByPoint, {
    point_alerts_ok: alertsRes.ok,
    polygons_ok: polygonsOk,
    forecast_ok: forecastRes.ok,
  });
  const inZone = verdict.state === "in_zone";
  const degraded = verdict.data_status.degraded;

  // Backward-compatible category mapping for the existing action checklist
  const checklistCategory: "in_zone" | "adjacent" | "out_of_zone" | "data_unavailable" =
    verdict.state === "in_zone" ? "in_zone"
    : (verdict.state === "downwind_threat" || verdict.state === "adjacent") ? "adjacent"
    : verdict.state === "data_unavailable" ? "data_unavailable"
    : "out_of_zone";
  const checklist = checklistCategory === "data_unavailable"
    ? buildDataUnavailableChecklist()
    : buildActionChecklist(
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
    // The 5-state verdict, clients should prefer this over `in_red_flag_zone` for UI rendering
    verdict,
    // Which live sources failed, duplicated at the top level so API consumers that
    // never look inside `verdict` still see that this response is degraded.
    data_status: {
      degraded,
      failed_sources: verdict.data_status.failed_sources,
      note: verdict.data_status.note,
    },
    // Static-map image URLs (real basemap + polygon overlay) the client can upgrade
    // to from the SVG, at three zoom levels {wide, area, close}, each an ordered
    // failover list. null unless a map provider key is configured + geometry exists.
    map_views: buildStaticMapUrls(lat, lng, verdict.nearest_polygon),
    // Legacy fields preserved for any existing integrators. `in_red_flag_zone` is
    // null — unknown — when the point query failed and geometry didn't prove in_zone;
    // a hard `false` there would falsely reassure legacy consumers during an outage.
    in_red_flag_zone: alertsRes.ok ? inZone : (inZone ? true : null),
    alerts: redFlagAlerts,
    other_alerts: pointAlerts.filter((a) => a.event !== "Red Flag Warning"),
    forecast: forecast,
    action_checklist: checklist,
    links: {
      genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
      official_ac_alert_signup: LOCAL_ALERTS_URL,
      watch_duty: WATCH_DUTY_URL,
      airnow_fire_map: AIRNOW_FIRE_MAP,
    },
    fire_context: pyrecast,
    sources: [
      "NWS api.weather.gov (Red Flag Warning polygons + hourly wind forecast)",
      "US Census geocoder (address → lat/lng)",
      "Genasys Protect (official evacuation zones)",
      ...(pyrecast ? ["Pyrecast/Pyregence (ELMFIRE fire spread model, LANDFIRE 2.5.0 fuels — open access)"] : []),
    ],
    disclaimer:
      "Informational only. The downwind-threat reading is a flat-earth wind-line approximation; ridges and canyons change actual fire paths. Always heed official evacuation orders. For official alerts, sign up for your county's emergency alerts. In case of fire, call 911. Full Terms of Use & Disclaimer: https://redflag-check.info/terms",
    generated_at: new Date().toISOString(),
  }, 200, degraded ? "no-store" : undefined);
}
