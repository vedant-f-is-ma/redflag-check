// GET /api/v1/school-status?id=<school_id>
//
// Returns: school metadata + zone check + tonight's wind/RH + recommended action
// (per CIF AQI guidelines + district policy where published).

import {
  fetchAlertsAtPoint,
  fetchForecastSummary,
  fetchActiveRedFlagPolygons,
  classifyVerdict,
  buildStaticMapUrls,
  jsonResponse,
  errorResponse,
} from "../_lib";
import { findSchool } from "../_schools";

export const config = { runtime: "edge" };

interface DecisionRec {
  level: "normal" | "modify_outdoor" | "indoors_only" | "consider_closure";
  rationale: string;
  source: string;
}

function decideAction(
  maxWindMph: number,
  minHumidityPct: number | null,
  inZone: boolean,
  isHillsAdjacent: boolean
): DecisionRec {
  if (inZone) {
    return {
      level: "indoors_only",
      rationale: `Active Red Flag Warning at this campus. Even if the air quality is fine, conditions favor explosive fire growth nearby and reduce outdoor safety. Move PE and athletics indoors during the warning window.`,
      source: "NWS Red Flag Warning + standard wildfire-day modification practice",
    };
  }
  if (maxWindMph >= 35) {
    return {
      level: "modify_outdoor",
      rationale: `Sustained or gust winds ≥35 mph forecast tonight. Consider postponing early-morning outdoor practice until winds drop below 25 mph; check NWS at 6 AM.`,
      source: "NWS hourly forecast at campus location",
    };
  }
  if (minHumidityPct !== null && minHumidityPct < 20) {
    return {
      level: "modify_outdoor",
      rationale: `Low relative humidity (<20%) forecast tonight indicates elevated fire weather. Monitor district communications and adjust outdoor activity accordingly.`,
      source: "NWS hourly forecast at campus location",
    };
  }
  if (isHillsAdjacent) {
    return {
      level: "normal",
      rationale: `Active Red Flag Warning in nearby hills, but this campus is on the valley floor. Normal operations advised. Monitor district communications in case conditions change.`,
      source: "Spatial proximity analysis",
    };
  }
  return {
    level: "normal",
    rationale: `No active Red Flag Warning at this campus and forecast conditions are within normal operating parameters.`,
    source: "NWS active alerts + hourly forecast",
  };
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorResponse("Provide ?id=<school_id> (see /api/v1/schools).", 400);

  const school = findSchool(id);
  if (!school) return errorResponse(`Unknown school id: ${id}`, 404);

  const [alerts, forecast, statePolygons] = await Promise.all([
    fetchAlertsAtPoint(school.lat, school.lng),
    fetchForecastSummary(school.lat, school.lng),
    fetchActiveRedFlagPolygons("CA"),
  ]);

  const redFlag = alerts.filter((a) => a.event === "Red Flag Warning");
  const inZone = redFlag.length > 0;
  const isHillsAdjacent = school.zone_class === "hills" || school.zone_class === "ridge";

  const maxWind = forecast?.tonight.max_wind_mph ?? 0;
  const minHumidity = forecast?.tonight.min_humidity_pct ?? null;

  const decision = decideAction(maxWind, minHumidity, inZone, isHillsAdjacent);

  // A school is just a named lat/lng, so compute the same 4-state verdict + map the
  // address path does, the result can then show the geo-map + wind/fire overlay.
  const verdict = classifyVerdict(school.lat, school.lng, statePolygons, forecast);
  const map_views = buildStaticMapUrls(school.lat, school.lng, verdict.nearest_polygon);

  return jsonResponse({
    school,
    location: { lat: school.lat, lng: school.lng, matched_address: `${school.name}, ${school.city}` },
    verdict,
    map_views,
    in_red_flag_zone: inZone,
    alerts: redFlag,
    forecast: forecast?.tonight ?? null,
    forecast_next_24h: forecast?.next_24h ?? null,
    decision_recommendation: decision,
    cif_aqi_thresholds_reference: {
      "100-150": "Modify outdoor practice (reduce intensity, allow water breaks)",
      "150-200": "Reschedule outdoor practice; move indoor",
      "200+": "Cancel outdoor activities; superintendent reviews closure",
      source: "California Interscholastic Federation Air Quality Index Guidelines (cifstate.org)",
    },
    disclaimer:
      "Informational guidance only. Final closure / modification decisions rest with district leadership and county health officer. This service does NOT replace official district SOPs.",
    generated_at: new Date().toISOString(),
  });
}
