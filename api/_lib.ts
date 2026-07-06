// Shared helpers: geocoding (US Census), NWS alert/forecast fetching, response shaping.
// All functions are pure and side-effect-free except for outbound HTTP.

// NWS requires a real contact in the User-Agent. The contact email is read from
// the NWS_CONTACT_EMAIL Vercel env var so it never appears in source.
// Falls back to the bare domain if the env var is unset (NWS still accepts requests).
const _contact = (typeof process !== "undefined" && process.env && process.env.NWS_CONTACT_EMAIL) || "";
export const USER_AGENT = _contact
  ? `redflag-check.info (${_contact})`
  : "redflag-check.info";

// ---------------------------------------------------------------------------
// Geocoding — Census street-address geocoder with Geoapify fallback.
// Census is fast and authoritative for US street addresses but can't resolve
// city names, ZIP-only, or landmark queries. Geoapify handles those cases.
// ---------------------------------------------------------------------------
export interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address: string;
  zip?: string;
  // 2-letter state code (e.g. "CA", "AZ"). Used to scope the regional Red Flag
  // Warning fetch when the address is NOT inside a warning (adjacency/downwind).
  state?: string;
}

// Normalize a provider's state field to a bare 2-letter code (what NWS area= wants).
// Census returns "CA"; Geoapify's state_code is usually "CA" but can be ISO 3166-2
// with a country prefix ("US-CA") — take the trailing subdivision. Returns undefined
// for anything that isn't a clean 2-letter code so we never pass garbage to NWS.
function normStateCode(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).toUpperCase().trim();
  const code = s.includes("-") ? s.slice(s.lastIndexOf("-") + 1) : s;
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

async function geocodeCensus(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const matches = data?.result?.addressMatches;
    if (!Array.isArray(matches) || matches.length === 0) return null;
    const m = matches[0];
    return {
      lat: m.coordinates.y,
      lng: m.coordinates.x,
      matched_address: m.matchedAddress,
      zip: m.addressComponents?.zip,
      state: normStateCode(m.addressComponents?.state),
    };
  } catch {
    return null;
  }
}

async function geocodeGeoapify(address: string): Promise<GeocodeResult | null> {
  const key = (typeof process !== "undefined" && process.env && process.env.GEOAPIFY_API_KEY) || "";
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&format=json&limit=1&apiKey=${key}`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const results = data?.results;
    if (!Array.isArray(results) || results.length === 0) return null;
    const r = results[0];
    return {
      lat: r.lat,
      lng: r.lon,
      matched_address: r.formatted,
      zip: r.postcode,
      state: normStateCode(r.state_code),
    };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const census = await geocodeCensus(address);
  if (census) return census;
  return geocodeGeoapify(address);
}

// Reverse geocode lat/lng -> a friendly "near {street}, {city}" label + the state
// code (Geoapify). The label lets a "use my location" check confirm WHERE it
// checked; the state scopes the out-of-zone regional Red Flag fetch so geolocation
// users still get nearest/adjacency/downwind (not just in_zone). null if no key,
// upstream failure, or no usable label could be built.
export interface ReverseGeocodeResult {
  label: string;
  state: string | undefined;
}
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  const key = (typeof process !== "undefined" && process.env && process.env.GEOAPIFY_API_KEY) || "";
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&format=json&apiKey=${key}`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const r = data?.results && data.results[0];
    if (!r) return null;
    const state = normStateCode(r.state_code);
    const street = r.street || r.suburb || r.neighbourhood || r.district || r.address_line1;
    const city = r.city || r.town || r.village || r.county;
    let label: string | null = null;
    if (street && city) label = `near ${street}, ${city}`;
    else if (street) label = `near ${street}`;
    else if (r.city) label = `near ${r.city}`;
    else if (r.formatted) label = `near ${r.formatted}`;
    if (!label) return null;
    return { label, state };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// NWS alerts at a point
// ---------------------------------------------------------------------------
export interface NWSAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  instruction: string | null;
  severity: string;
  certainty: string;
  urgency: string;
  starts: string;
  ends: string;
  expires: string;
  sender_name: string;
  areas: string[];
  // NWS Universal Geographic Codes for the affected zones (e.g. ["AZZ112", ...]).
  // Lets us resolve the point's OWN active warnings to zone geometry without a
  // separate per-state fetch. Empty array when the alert carries no UGC codes.
  ugc: string[];
}

export async function fetchAlertsAtPoint(lat: number, lng: number): Promise<NWSAlert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${lat},${lng}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const features = data?.features || [];
  return features.map((f: any) => {
    const p = f.properties || {};
    return {
      id: f.id || p.id,
      event: p.event,
      headline: p.headline,
      description: p.description,
      instruction: p.instruction,
      severity: p.severity,
      certainty: p.certainty,
      urgency: p.urgency,
      starts: p.onset || p.effective || p.sent,
      ends: p.ends || p.expires,
      expires: p.expires,
      sender_name: p.senderName,
      areas: (p.areaDesc || "").split(";").map((s: string) => s.trim()),
      ugc: (p.geocode?.UGC ?? []) as string[],
    };
  });
}

// ---------------------------------------------------------------------------
// NWS gridpoint forecast (hourly, for wind / RH / temp tonight)
// ---------------------------------------------------------------------------
export interface ForecastPeriod {
  start_iso: string;
  end_iso: string;
  temp_f: number;
  wind_speed_mph_max: number;
  wind_direction: string;
  humidity_pct: number | null;
  short_forecast: string;
}

export interface ForecastSummary {
  next_24h: ForecastPeriod[];
  tonight: {
    max_wind_mph: number;
    min_humidity_pct: number | null;
    summary: string;
  };
}

function parseWindSpeed(s: string): number {
  // NWS hourly wind speed comes as e.g. "15 mph" or "10 to 20 mph"
  if (!s) return 0;
  const nums = s.match(/\d+/g);
  if (!nums) return 0;
  return Math.max(...nums.map(Number));
}

export async function fetchForecastSummary(lat: number, lng: number): Promise<ForecastSummary | null> {
  // Step 1: get gridpoint
  const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;
  const pointsRes = await fetch(pointsUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!pointsRes.ok) return null;
  const points = (await pointsRes.json()) as any;
  const forecastHourlyUrl = points?.properties?.forecastHourly;
  if (!forecastHourlyUrl) return null;

  // Step 2: fetch hourly forecast
  const fcRes = await fetch(forecastHourlyUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!fcRes.ok) return null;
  const fc = (await fcRes.json()) as any;
  const periods: any[] = fc?.properties?.periods || [];

  const next24 = periods.slice(0, 24).map((p) => ({
    start_iso: p.startTime,
    end_iso: p.endTime,
    temp_f: p.temperature,
    wind_speed_mph_max: parseWindSpeed(p.windSpeed),
    wind_direction: p.windDirection,
    humidity_pct: p.relativeHumidity?.value ?? null,
    short_forecast: p.shortForecast,
  }));

  // "tonight" = periods starting after 8pm local through 9am next day
  // Use a simple heuristic on UTC: just look at the next 16 hours (covers tonight + tomorrow morning)
  const tonightWindow = next24.slice(0, 16);
  const maxWind = tonightWindow.reduce((m, p) => Math.max(m, p.wind_speed_mph_max), 0);
  const humidities = tonightWindow.map((p) => p.humidity_pct).filter((h): h is number => h !== null);
  const minHumidity = humidities.length ? Math.min(...humidities) : null;
  const summary = tonightWindow[0]?.short_forecast || "";

  return {
    next_24h: next24,
    tonight: {
      max_wind_mph: maxWind,
      min_humidity_pct: minHumidity,
      summary,
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers (spherical earth, miles)
// ---------------------------------------------------------------------------
const EARTH_RADIUS_MI = 3958.8;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Bearing FROM (lat1,lng1) TO (lat2,lng2), in degrees 0..360 (0 = N, 90 = E)
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const λ1 = (lng1 * Math.PI) / 180;
  const λ2 = (lng2 * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function bearingToCompass(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// NWS compass cardinal (e.g. "NE", "ENE") → bearing degrees (the wind-FROM direction).
export function compassToBearing(compass: string): number | null {
  if (!compass) return null;
  const map: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return map[compass.toUpperCase().trim()] ?? null;
}

// Min angular difference between two bearings (0..180)
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Point-in-polygon via ray casting. polygon = array of [lng, lat] (GeoJSON convention)
export function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Distance from point to nearest edge of polygon, plus the closest point on that edge.
// polygon = array of [lng, lat] (GeoJSON). Uses flat-earth approximation locally then haversine.
export function pointToPolygonNearest(
  lat: number,
  lng: number,
  polygon: number[][]
): { distance_mi: number; nearest_lat: number; nearest_lng: number } {
  if (polygon.length === 0) return { distance_mi: Infinity, nearest_lat: lat, nearest_lng: lng };
  let best = { distance_mi: Infinity, nearest_lat: lat, nearest_lng: lng };
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    // Project both endpoints into local flat space (units: degrees, scaled)
    const ex = (x2 - x1) * cosLat;
    const ey = y2 - y1;
    const lenSq = ex * ex + ey * ey;
    let cx: number, cy: number;
    if (lenSq === 0) {
      cx = x1; cy = y1;
    } else {
      const t = Math.max(0, Math.min(1, (((lng - x1) * cosLat * ex) + (lat - y1) * ey) / lenSq));
      cx = x1 + t * (x2 - x1);
      cy = y1 + t * (y2 - y1);
    }
    const d = haversineMiles(lat, lng, cy, cx);
    if (d < best.distance_mi) best = { distance_mi: d, nearest_lat: cy, nearest_lng: cx };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fetch all active Red Flag Warnings in a state, WITH their polygon geometry.
// This is the source for "are you in any polygon" + "how far / which direction is the nearest polygon"
// ---------------------------------------------------------------------------
export interface RedFlagPolygon {
  id: string;
  event: string;
  headline: string;
  description: string;
  instruction: string | null;
  starts: string;
  ends: string;
  expires: string;
  severity: string;
  sender_name: string;
  areas: string[];
  // GeoJSON polygon: outer ring as array of [lng, lat]. We flatten MultiPolygon to first ring's outer.
  rings: number[][][]; // array of rings; ring 0 is the outer ring
  // Whether geometry came from the alert itself or was resolved from NWS zone boundaries.
  source: "polygon" | "zone";
}

// ---------------------------------------------------------------------------
// Zone geometry resolution — fallback when an alert has no inline polygon.
// UGC code format: {STATE}{C|Z}{number}  C=county  Z=fire-weather zone
// ---------------------------------------------------------------------------
async function fetchZoneRing(ugcCode: string): Promise<number[][] | null> {
  const zoneType = ugcCode[2] === "C" ? "county" : "fire";
  const url = `https://api.weather.gov/zones/${zoneType}/${ugcCode}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const geom = data?.geometry;
    if (!geom) return null;
    if (geom.type === "Polygon") return geom.coordinates[0] ?? null;
    if (geom.type === "MultiPolygon") return geom.coordinates[0]?.[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

// Normalized input to buildRedFlagPolygon: an alert's metadata plus EITHER inline
// geometry (polygon-based RFW) OR UGC codes (zone-based RFW) to resolve from.
interface RedFlagSource {
  id: string;
  event: string;
  headline: string;
  description: string;
  instruction: string | null;
  starts: string;
  ends: string;
  expires: string;
  severity: string;
  sender_name: string;
  areas: string[];
  geometry: any | null; // inline GeoJSON geometry, or null/undefined for zone-based
  ugc: string[];        // UGC codes used to resolve geometry when geometry is null
}

// Resolve one alert to a RedFlagPolygon. Inline polygon geometry is used directly;
// otherwise each UGC zone boundary is resolved in parallel. Returns null if neither
// inline geometry nor any resolvable zone produced a ring.
async function buildRedFlagPolygon(src: RedFlagSource): Promise<RedFlagPolygon | null> {
  let rings: number[][][] = [];
  let source: "polygon" | "zone";

  if (src.geometry) {
    if (src.geometry.type === "Polygon") {
      rings = src.geometry.coordinates;
    } else if (src.geometry.type === "MultiPolygon") {
      rings = src.geometry.coordinates.map((poly: number[][][]) => poly[0]);
    } else {
      return null;
    }
    source = "polygon";
  } else {
    if (src.ugc.length === 0) return null;
    const zoneRings = (await Promise.all(src.ugc.map(fetchZoneRing))).filter(
      (r): r is number[][] => r !== null
    );
    if (zoneRings.length === 0) return null;
    rings = zoneRings;
    source = "zone";
  }

  if (rings.length === 0) return null;
  return {
    id: src.id,
    event: src.event,
    headline: src.headline,
    description: src.description,
    instruction: src.instruction,
    starts: src.starts,
    ends: src.ends,
    expires: src.expires,
    severity: src.severity,
    sender_name: src.sender_name,
    areas: src.areas,
    rings,
    source,
  };
}

// Fetch active Red Flag Warnings WITH geometry for one or more state/area codes.
// `area` accepts a single code ("CA") or several (["AZ","NM","CO"]); the NWS
// alerts endpoint takes a comma-separated list. Used for the OUT-of-zone path
// (nearest / adjacency / downwind) where we need warnings near — but not
// necessarily containing — the point.
export async function fetchActiveRedFlagPolygons(area: string | string[] = "CA"): Promise<RedFlagPolygon[]> {
  const areaParam = Array.isArray(area) ? area.join(",") : area;
  const url = `https://api.weather.gov/alerts/active?area=${encodeURIComponent(areaParam)}&event=Red%20Flag%20Warning`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const features: any[] = data?.features || [];

  // Process alerts in parallel so zone-geometry fetches don't serialize.
  const results = await Promise.all(
    features.map((f: any) => {
      const p = f.properties || {};
      return buildRedFlagPolygon({
        id: f.id || p.id,
        event: p.event,
        headline: p.headline,
        description: p.description,
        instruction: p.instruction,
        starts: p.onset || p.effective || p.sent,
        ends: p.ends || p.expires,
        expires: p.expires,
        severity: p.severity,
        sender_name: p.senderName,
        areas: (p.areaDesc || "").split(";").map((s: string) => s.trim()),
        geometry: f.geometry,
        ugc: (p.geocode?.UGC ?? []) as string[],
      });
    })
  );

  return results.filter((r): r is RedFlagPolygon => r !== null);
}

// Resolve the point's OWN active warnings (as returned by fetchAlertsAtPoint) into
// drawable/measurable polygons. The point query authoritatively answers "is this
// point inside an active warning"; this turns that yes into the actual zone geometry
// so the map can draw it and we can measure to its edges. Zone-based alerts resolve
// via their UGC codes. If resolution yields nothing (zone fetch failed), the caller
// still treats the point as in_zone from the alert's existence — geometry is never
// the gate on the safety verdict.
export async function resolveAlertsToPolygons(alerts: NWSAlert[]): Promise<RedFlagPolygon[]> {
  const results = await Promise.all(
    alerts.map((a) =>
      buildRedFlagPolygon({
        id: a.id,
        event: a.event,
        headline: a.headline,
        description: a.description,
        instruction: a.instruction,
        starts: a.starts,
        ends: a.ends,
        expires: a.expires,
        severity: a.severity,
        sender_name: a.sender_name,
        areas: a.areas,
        geometry: null,
        ugc: a.ugc,
      })
    )
  );
  return results.filter((r): r is RedFlagPolygon => r !== null);
}

// ---------------------------------------------------------------------------
// Verdict logic: classify the user's address into one of 4 states.
// ---------------------------------------------------------------------------
export type VerdictState = "in_zone" | "downwind_threat" | "adjacent" | "safe_tonight";

export interface NearestPolygonInfo {
  polygon_id: string;
  polygon_headline: string;
  distance_mi: number;
  bearing_to_polygon_deg: number;        // bearing FROM user TO polygon (degrees from north)
  bearing_to_polygon_compass: string;    // e.g. "NE"
  nearest_lat: number;                   // closest point on polygon to user
  nearest_lng: number;
  // Outer ring of the nearest polygon as [lng, lat] pairs (GeoJSON order), lightly
  // simplified for payload size. Lets clients draw the ACTUAL warning-area shape
  // (the geo-map view) instead of only a distance/bearing abstraction.
  ring: number[][];
  source: "polygon" | "zone";
}

// Cap a ring's vertex count for payload size while preserving overall shape.
// Naive every-k decimation is fine for a display outline (always keeps first/last).
export function simplifyRing(ring: number[][], maxPoints = 160): number[][] {
  if (ring.length <= maxPoints) return ring;
  const step = Math.ceil(ring.length / maxPoints);
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export interface WindVector {
  wind_from_compass: string;       // e.g. "NE" (the NWS shorthand, direction wind is blowing FROM)
  wind_from_deg: number | null;    // 0..360 if parseable
  wind_to_deg: number | null;      // the direction wind is BLOWING TOWARD (180° opposite)
  wind_to_compass: string | null;
  wind_speed_mph_peak: number;     // peak speed during the warning window
}

export interface DownwindAnalysis {
  triggered: boolean;
  alignment_angle_deg: number | null;  // 0 = wind comes from exactly the polygon's direction
  threat_level: "high" | "moderate" | "low" | "none";
  explanation: string;
}

export interface Verdict {
  state: VerdictState;
  headline: string;                // plain-English, action-oriented
  short_explanation: string;       // 1 sentence
  nearest_polygon: NearestPolygonInfo | null;
  wind_vector: WindVector | null;
  downwind: DownwindAnalysis;
}

const DOWNWIND_MAX_DISTANCE_MI = 25;     // beyond this, wind alignment doesn't meaningfully matter for 1-night spread
const DOWNWIND_ALIGNMENT_DEG = 60;       // wind direction must be within ±this of polygon's bearing
const DOWNWIND_MIN_WIND_MPH = 15;        // below this, wind isn't strong enough to materially push fire conditions
const ADJACENT_MAX_DISTANCE_MI = 5;      // within this, always flag as adjacent regardless of wind

export function classifyVerdict(
  userLat: number,
  userLng: number,
  polygons: RedFlagPolygon[],
  forecast: ForecastSummary | null,
  // Authoritative in_zone signal from the NWS point query: when the point's own
  // active-alert lookup returned a Red Flag Warning, the point IS inside an active
  // warning regardless of local point-in-polygon math (which can miss on zone
  // geometry that failed to resolve, multi-part zones, or simplification). This is
  // the fix for zone-based (UGC-only) warnings reading as safe_tonight.
  forceInZone = false
): Verdict {
  // Step 1: is the user inside ANY active polygon?
  let inZonePolygon: RedFlagPolygon | null = null;
  for (const poly of polygons) {
    for (const ring of poly.rings) {
      if (pointInPolygon(userLat, userLng, ring)) {
        inZonePolygon = poly;
        break;
      }
    }
    if (inZonePolygon) break;
  }

  // Step 2: find the closest polygon edge (whether or not we're inside one)
  let nearest: NearestPolygonInfo | null = null;
  let nearestPoly: RedFlagPolygon | null = null;
  let nearestDist = Infinity;
  for (const poly of polygons) {
    for (const ring of poly.rings) {
      const r = pointToPolygonNearest(userLat, userLng, ring);
      if (r.distance_mi < nearestDist) {
        nearestDist = r.distance_mi;
        nearestPoly = poly;
        const bearing = bearingDeg(userLat, userLng, r.nearest_lat, r.nearest_lng);
        nearest = {
          polygon_id: poly.id,
          polygon_headline: poly.headline,
          distance_mi: r.distance_mi,
          bearing_to_polygon_deg: bearing,
          bearing_to_polygon_compass: bearingToCompass(bearing),
          nearest_lat: r.nearest_lat,
          nearest_lng: r.nearest_lng,
          ring: simplifyRing(ring),
          source: poly.source,
        };
      }
    }
  }

  // Step 3: compute wind vector (during the warning window or tonight overall)
  let windVector: WindVector | null = null;
  if (forecast && forecast.next_24h.length > 0) {
    // Use the period with the highest wind speed in the next 24h as the "worst case"
    let peakPeriod = forecast.next_24h[0];
    for (const p of forecast.next_24h) {
      if (p.wind_speed_mph_max > peakPeriod.wind_speed_mph_max) peakPeriod = p;
    }
    const windFromDeg = compassToBearing(peakPeriod.wind_direction);
    const windToDeg = windFromDeg !== null ? (windFromDeg + 180) % 360 : null;
    windVector = {
      wind_from_compass: peakPeriod.wind_direction,
      wind_from_deg: windFromDeg,
      wind_to_deg: windToDeg,
      wind_to_compass: windToDeg !== null ? bearingToCompass(windToDeg) : null,
      wind_speed_mph_peak: peakPeriod.wind_speed_mph_max,
    };
  }

  // Step 4: build the verdict
  // forceInZone (point query saw an RFW) is authoritative; inZonePolygon is the
  // local geometry confirmation. Either one means in_zone. We return here BEFORE
  // any downwind/adjacency analysis so a forced in_zone never gets a downwind
  // headline computed against some far polygon.
  if (forceInZone || inZonePolygon) {
    return {
      state: "in_zone",
      headline: "Your address is inside the active Red Flag Warning.",
      short_explanation: "Take action tonight: prepare a go-bag and be ready to leave if instructed.",
      nearest_polygon: nearest,
      wind_vector: windVector,
      downwind: { triggered: false, alignment_angle_deg: null, threat_level: "none", explanation: "You are inside the active Red Flag Warning area." },
    };
  }

  // Compute downwind analysis if there's a nearest polygon
  let downwind: DownwindAnalysis = { triggered: false, alignment_angle_deg: null, threat_level: "none", explanation: "" };
  if (nearest && windVector && windVector.wind_from_deg !== null) {
    // The question: is the wind coming FROM the polygon's direction?
    // i.e. is bearing_user_to_polygon close to wind_from_deg?
    const alignment = angularDiff(nearest.bearing_to_polygon_deg, windVector.wind_from_deg);
    downwind.alignment_angle_deg = Math.round(alignment);
    if (
      nearest.distance_mi <= DOWNWIND_MAX_DISTANCE_MI &&
      alignment <= DOWNWIND_ALIGNMENT_DEG &&
      windVector.wind_speed_mph_peak >= DOWNWIND_MIN_WIND_MPH
    ) {
      downwind.triggered = true;
      // Threat level scales with: closer = worse, more-aligned = worse, faster wind = worse
      const closeness = Math.max(0, 1 - nearest.distance_mi / DOWNWIND_MAX_DISTANCE_MI);
      const align = Math.max(0, 1 - alignment / DOWNWIND_ALIGNMENT_DEG);
      const speed = Math.min(1, (windVector.wind_speed_mph_peak - DOWNWIND_MIN_WIND_MPH) / 30);
      const score = closeness * 0.4 + align * 0.4 + speed * 0.2;
      downwind.threat_level = score > 0.66 ? "high" : score > 0.33 ? "moderate" : "low";
      downwind.explanation = `Active warning is ${Math.round(nearest.distance_mi)} mi ${nearest.bearing_to_polygon_compass} of you. Tonight's wind is from the ${windVector.wind_from_compass} at ${Math.round(windVector.wind_speed_mph_peak)} mph. That means fire-favorable conditions in the warning area are pointing toward you.`;
    } else {
      downwind.threat_level = "none";
      downwind.explanation = nearest.distance_mi > DOWNWIND_MAX_DISTANCE_MI
        ? `Nearest active warning is ${Math.round(nearest.distance_mi)} mi away. Too far for tonight's wind to matter.`
        : windVector.wind_speed_mph_peak < DOWNWIND_MIN_WIND_MPH
        ? "Wind tonight is light enough that fire conditions aren't strongly pushed in any direction."
        : "Wind tonight is blowing away from the active warning area, not toward you.";
    }
  }

  // Decide state
  if (downwind.triggered) {
    return {
      state: "downwind_threat",
      headline: "Wind is pushing fire conditions toward your address tonight.",
      short_explanation: downwind.explanation,
      nearest_polygon: nearest,
      wind_vector: windVector,
      downwind,
    };
  }

  if (nearest && nearest.distance_mi <= ADJACENT_MAX_DISTANCE_MI) {
    return {
      state: "adjacent",
      headline: "You're near the active warning. Stay alert.",
      short_explanation: `Nearest active warning is ${Math.round(nearest.distance_mi)} mi ${nearest.bearing_to_polygon_compass} of you. Conditions could shift.`,
      nearest_polygon: nearest,
      wind_vector: windVector,
      downwind,
    };
  }

  return {
    state: "safe_tonight",
    headline: nearest
      ? "You're in a safer area tonight."
      : "No active Red Flag Warning anywhere near you.",
    short_explanation: nearest
      ? (windVector ? `Active warning is ${Math.round(nearest.distance_mi)} mi away and wind is blowing fire conditions away from you.` : `Active warning is ${Math.round(nearest.distance_mi)} mi away from you.`)
      : "Fire-season preparedness still matters, but tonight is not a wind-driven fire-weather event for your address.",
    nearest_polygon: nearest,
    wind_vector: windVector,
    downwind,
  };
}

// ---------------------------------------------------------------------------
// Action checklist generation
// ---------------------------------------------------------------------------
export interface ActionChecklist {
  category: "in_zone" | "adjacent" | "out_of_zone";
  do_now: string[];
  do_not: string[];
  if_evacuation_called: string[];
}

export function buildActionChecklist(inZone: boolean, isHillsAdjacent: boolean): ActionChecklist {
  if (inZone) {
    return {
      category: "in_zone",
      do_now: [
        "Charge your phone. Keep car keys near the door.",
        "Park your car facing OUTWARD on the driveway.",
        "Fill the gas tank above half.",
        "Pack a go-bag: meds, IDs, phone charger, water, sturdy shoes.",
        "Locate your evacuation zone number (link below) and write it down.",
        "Make a plan for pets and family members who need assistance.",
        "Set a buddy to text-check you at 11 PM tonight and 6 AM tomorrow.",
      ],
      do_not: [
        "Do NOT mow dry grass.",
        "Do NOT use BBQs, fire pits, or open flames outdoors.",
        "Do NOT park on dry grass.",
        "Do NOT drag chains (boat trailers, etc.). Sparks.",
        "Do NOT operate power tools that throw sparks.",
      ],
      if_evacuation_called: [
        "Leave immediately. Do not wait for a second notice.",
        "Take the go-bag, pets, phone, charger, IDs.",
        "Check Genasys Protect for your zone's status before driving.",
        "Use main roads. Avoid the canyons.",
      ],
    };
  }
  if (isHillsAdjacent) {
    return {
      category: "adjacent",
      do_now: [
        "Your address is adjacent to the active RFW Affected Area.",
        "Wind-driven fires do not stop at the RFW Affected Area boundary. The 1991 Oakland Hills fire, the 2023 Lahaina fire, and the 2025 Palisades fire all pushed past nominal boundaries in wind events. Treat tonight as a fire-weather night.",
        "Keep your phone charged and bring it to bed with sound on.",
        "Sign up for your county's emergency alerts if you haven't (link below).",
        "Know your Genasys zone in case conditions change.",
      ],
      do_not: [
        "Do NOT do anything that throws sparks outdoors tonight.",
        "Avoid driving through fire-prone hill and canyon routes if not essential.",
      ],
      if_evacuation_called: [
        "Wind-driven fires move fast. Be ready to leave even if you're adjacent.",
      ],
    };
  }
  return {
    category: "out_of_zone",
    do_now: [
      "Your address is outside the active RFW Affected Area.",
      "Important: this does NOT mean fire-safe. NWS RFW Affected Areas are advisory, not boundaries that stop fire. The 1991 Oakland Hills fire, Lahaina, and the Palisades fire all pushed past nominal boundaries in wind events until they ran out of fuel or hit the ocean. During fire season, keep a go-bag ready regardless of where the Affected Area boundary falls.",
      "Tonight is still a fire-weather night in your area. Avoid sparking activities outdoors.",
      "Text a neighbor in the hills. They are in the active RFW Affected Area and pre-positioning matters most in the next few hours.",
      "Sign up for your county's emergency alerts in case conditions expand (link below).",
    ],
    do_not: [
      "Do not assume being outside the RFW Affected Area means safe. A wind-driven fire can reach you even from an active Affected Area next door.",
    ],
    if_evacuation_called: [
      "If your area becomes affected, check Genasys Protect for your zone (link below).",
    ],
  };
}

// ---------------------------------------------------------------------------
// Static map image URLs (progressive enhancement over the SVG geo-map).
// The client renders the SVG instantly, then tries to UPGRADE to a real basemap
// image loaded directly from the provider CDN. We build the URL server-side
// because we already have the geometry + the key; the client just sets <img src>.
// Returns an ORDERED list for failover (first that loads wins; SVG is the final
// fallback). Returns [] when there's no key or no drawable geometry, so the
// feature no-ops gracefully until a key is configured.
// ---------------------------------------------------------------------------

// Web-Mercator zoom that fits a lat/lng bbox into a width x height pixel frame.
function fitZoom(latMin: number, latMax: number, lngMin: number, lngMax: number, w: number, h: number): number {
  const latRad = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return Math.log((1 + s) / (1 - s)) / 2;
  };
  const lngFrac = Math.max((lngMax - lngMin) / 360, 1e-6);
  const latFrac = Math.max((latRad(latMax) - latRad(latMin)) / (2 * Math.PI), 1e-6);
  const z = Math.min(Math.log2(w / 256 / lngFrac), Math.log2(h / 256 / latFrac));
  return Math.max(3, Math.min(16, z));
}

export interface MapView {
  urls: string[];              // ordered provider URLs (failover; first that loads wins)
  you_px: [number, number];    // the user's pixel position in the WxH image (for overlays)
}
export interface MapViews {
  wide: MapView;    // zoomed out, more regional context
  area: MapView;    // default, the warning zone + your location
  close: MapView;   // street level
  closer: MapView;  // block level, most zoomed in
}

export function buildStaticMapUrls(userLat: number, userLng: number, nearest: NearestPolygonInfo | null): MapViews | null {
  const geoapifyKey = (typeof process !== "undefined" && process.env && process.env.GEOAPIFY_API_KEY) || "";
  if (!geoapifyKey) return null;                        // no provider key -> client keeps the SVG

  const W = 480, H = 315;
  const marker = `lonlat:${userLng.toFixed(5)},${userLat.toFixed(5)};type:material;color:%23ff6b3d;size:large`;

  // No usable warning polygon (safe result, or a polygon too far to draw): render a
  // user-centered "here's your area" basemap so a safe lookup still shows a map instead of
  // looking like a failed load. Marker only, no geometry, fixed neighborhood->block zooms.
  const hasPolygon = !!nearest && Array.isArray(nearest.ring) && nearest.ring.length >= 3
    && isFinite(nearest.distance_mi) && nearest.distance_mi <= 60;
  if (!hasPolygon) {
    const userMap = (z: number) =>
      `https://maps.geoapify.com/v1/staticmap?style=osm-bright-grey` +
      `&width=${W}&height=${H}&center=lonlat:${userLng.toFixed(5)},${userLat.toFixed(5)}` +
      `&zoom=${z.toFixed(2)}&marker=${marker}&apiKey=${geoapifyKey}`;
    const mkU = (z: number): MapView => ({ urls: [userMap(z)], you_px: [W / 2, H / 2] });
    return { wide: mkU(10.5), area: mkU(12.5), close: mkU(14.5), closer: mkU(16) };
  }
  if (!nearest) return null; // narrowing for TS; hasPolygon already guarantees non-null

  const ring = simplifyRing(nearest.ring, 48); // fewer points = faster Geoapify render + shorter URL

  // bbox over ring + user, padded
  let minLat = userLat, maxLat = userLat, minLng = userLng, maxLng = userLng;
  for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  // Guarantee the user pin keeps breathing room from every edge so it never clips,
  // extra on top because the material pin's body extends UP (north) from its tip.
  const spanLat0 = (maxLat - minLat) || 0.02;
  const spanLng0 = (maxLng - minLng) || 0.02;
  minLat = Math.min(minLat, userLat - spanLat0 * 0.20);
  maxLat = Math.max(maxLat, userLat + spanLat0 * 0.32);
  minLng = Math.min(minLng, userLng - spanLng0 * 0.22);
  maxLng = Math.max(maxLng, userLng + spanLng0 * 0.22);

  const padLat = Math.max((maxLat - minLat) * 0.12, 0.01);
  const padLng = Math.max((maxLng - minLng) * 0.12, 0.01);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  // Center EVERY view on the address so the user is always at the image center.
  // This is robust to the provider's framing/zoom quirks (which don't match a naive
  // Mercator projection), and lets the client anchor the wind arrow at the center.
  const hLng = Math.max(userLng - minLng, maxLng - userLng);
  const hLat = Math.max(userLat - minLat, maxLat - userLat);
  const fit = fitZoom(userLat - hLat, userLat + hLat, userLng - hLng, userLng + hLng, W, H);

  // --- Geoapify (light/minimal style, free tier, no card) ---
  const polyCoords = ring.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(",");
  const geometry = `polygon:${polyCoords};linecolor:%23d7261a;linewidth:3;fillcolor:%23ff3b30;fillopacity:0.12`;
  const geoapify = (z: number) =>
    `https://maps.geoapify.com/v1/staticmap?style=osm-bright-grey` +
    `&width=${W}&height=${H}&center=lonlat:${userLng.toFixed(5)},${userLat.toFixed(5)}` +
    `&zoom=${z.toFixed(2)}&geometry=${geometry}&marker=${marker}&apiKey=${geoapifyKey}`;

  // Three zoom views, all centered on the address (so you_px is the image center).
  // "close" goes to street level (~16-18); the polygon is usually off-frame there,
  // so the client draws a fire-direction indicator.
  const mk = (z: number): MapView => ({ urls: [geoapify(z)], you_px: [W / 2, H / 2] });
  return {
    wide:   mk(Math.max(3, fit - 1)),
    area:   mk(fit),
    close:  mk(Math.min(17, Math.max(fit + 4, 16))),   // street level
    closer: mk(Math.min(19, Math.max(fit + 6, 18))),   // block level
  };
}

// ---------------------------------------------------------------------------
// EPSG:3310 — NAD83 / California Albers Equal-Area Conic (pure TypeScript)
// Implements the ellipsoidal Albers formulae from USGS PP-1395.
// Valid for CA + adjacent West states (lat 31-43, lng -125 to -112).
// ---------------------------------------------------------------------------

const _A83 = 6_378_137.0;                   // GRS80 semi-major axis (m)
const _E2_83 = 0.00669437999014;            // GRS80 eccentricity squared
const _E_83 = Math.sqrt(_E2_83);

const _ALBERS_PHI1 = 34.0 * (Math.PI / 180);   // 1st standard parallel
const _ALBERS_PHI2 = 40.5 * (Math.PI / 180);   // 2nd standard parallel
const _ALBERS_LAM0 = -120.0 * (Math.PI / 180); // central meridian
const _ALBERS_FN = -4_000_000.0;               // false northing (m)

function _mA(phi: number): number {
  return Math.cos(phi) / Math.sqrt(1 - _E2_83 * Math.sin(phi) ** 2);
}
function _qA(phi: number): number {
  const s = Math.sin(phi);
  const es = _E_83 * s;
  return (1 - _E2_83) * (s / (1 - _E2_83 * s * s) - Math.log((1 - es) / (1 + es)) / (2 * _E_83));
}

const _m1A = _mA(_ALBERS_PHI1);
const _m2A = _mA(_ALBERS_PHI2);
const _q1A = _qA(_ALBERS_PHI1);
const _q2A = _qA(_ALBERS_PHI2);
const _q0A = _qA(0);
const _nA  = (_m1A * _m1A - _m2A * _m2A) / (_q2A - _q1A);
const _CA  = _m1A * _m1A + _nA * _q1A;
const _rho0A = _A83 * Math.sqrt(_CA - _nA * _q0A) / _nA;

export function wgs84ToEPSG3310(lat: number, lng: number): { x: number; y: number } {
  const phi = lat * (Math.PI / 180);
  const lam = lng * (Math.PI / 180);
  const q = _qA(phi);
  const rho = _A83 * Math.sqrt(_CA - _nA * q) / _nA;
  const theta = _nA * (lam - _ALBERS_LAM0);
  return {
    x: Math.round(rho * Math.sin(theta)),
    y: Math.round(_rho0A - rho * Math.cos(theta) + _ALBERS_FN),
  };
}

// ---------------------------------------------------------------------------
// Pyrecast GeoServer — LANDFIRE fuel type + ELMFIRE Risk/Consequence forecast
// Open access (no credentials required). geoserver-usw1.pyrecast.org/geoserver01
// ---------------------------------------------------------------------------

const _PYRECAST = "https://geoserver-usw1.pyrecast.org/geoserver01/ows";
const _PYRECAST_R = 500; // ±500m BBOX radius for point lookup

// Daily ELMFIRE runs publish at 12:00 UTC; allow 6h processing before switching.
function _latestRun(): string {
  const now = new Date();
  const d = now.getUTCHours() >= 18 ? now : new Date(now.getTime() - 86_400_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}_12`;
}

function _pyrecastUrl(layer: string, x: number, y: number, featureCount: number): string {
  const bbox = `${x - _PYRECAST_R},${y - _PYRECAST_R},${x + _PYRECAST_R},${y + _PYRECAST_R}`;
  const enc = encodeURIComponent(layer);
  return `${_PYRECAST}?service=WMS&version=1.3.0&request=GetFeatureInfo` +
    `&layers=${enc}&query_layers=${enc}` +
    `&bbox=${bbox}&width=10&height=10&crs=EPSG:3310&i=5&j=5` +
    `&info_format=text/plain&FEATURE_COUNT=${featureCount}`;
}

function _parseGrayIndices(text: string): number[] {
  return Array.from(text.matchAll(/GRAY_INDEX\s*=\s*([\d.]+)/g))
    .map((m) => parseFloat(m[1]))
    .filter((v) => isFinite(v));
}

// LANDFIRE FBFM40 (Scott & Burgan 40 fuel models) → human-readable description
function _describeFBFM40(code: number): { description: string; fire_behavior: string } {
  if (code >= 101 && code <= 109) return { description: `Grass (GR${code - 100})`,           fire_behavior: "Fast spread, moderate flame height" };
  if (code >= 121 && code <= 129) return { description: `Grass-Shrub (GS${code - 120})`,      fire_behavior: "High spread potential, spotting risk" };
  if (code >= 141 && code <= 149) return { description: `Shrub (SH${code - 140})`,            fire_behavior: "High intensity, strong spotting" };
  if (code >= 161 && code <= 169) return { description: `Timber Understory (TU${code - 160})`,fire_behavior: "Moderate spread, ladder fuel risk" };
  if (code >= 181 && code <= 189) return { description: `Timber Litter (TL${code - 180})`,    fire_behavior: "Moderate spread, deep fire in litter" };
  if (code >= 191 && code <= 199) return { description: `Slash-Blowdown (SB${code - 190})`,   fire_behavior: "High intensity if ignited" };
  if (code >= 91  && code <= 99)  return { description: "Non-burnable",                       fire_behavior: "Minimal fire risk" };
  return { description: `Fuel model ${code}`, fire_behavior: "See LANDFIRE documentation" };
}

export interface PyrecastData {
  fuel_type: {
    fbfm40_code: number | null;
    description: string | null;
    fire_behavior: string | null;
  };
  risk_forecast: {
    run_date: string;
    max_impacted_structures: number;
    is_active: boolean;
  };
  source: string;
}

// Fetches background fuel type (always) and ELMFIRE 24-hour impacted-structures
// forecast in parallel. Returns null if outside coverage area or both fetches fail.
export async function fetchPyrecastData(lat: number, lng: number): Promise<PyrecastData | null> {
  if (lat < 31 || lat > 43 || lng < -125 || lng > -112) return null;
  const { x, y } = wgs84ToEPSG3310(lat, lng);
  const runDate = _latestRun();

  const [fuelRes, riskRes] = await Promise.allSettled([
    fetch(_pyrecastUrl("fuels-and-topography_landfire-2.5.0:fbfm40", x, y, 1)),
    fetch(_pyrecastUrl(`fire-risk-forecast_all_${runDate}:elmfire_landfire_impacted-structures`, x, y, 24)),
  ]);

  let fbfm40: number | null = null;
  if (fuelRes.status === "fulfilled" && fuelRes.value.ok) {
    const vals = _parseGrayIndices(await fuelRes.value.text());
    if (vals.length > 0) fbfm40 = vals[0];
  }

  let maxImpacted = 0;
  let riskOk = false;
  if (riskRes.status === "fulfilled" && riskRes.value.ok) {
    riskOk = true;
    const vals = _parseGrayIndices(await riskRes.value.text());
    if (vals.length > 0) maxImpacted = Math.max(...vals);
  }

  // Nothing useful if we got no fuel type and the risk request also failed
  if (fbfm40 === null && !riskOk) return null;

  const fuelInfo = fbfm40 !== null ? _describeFBFM40(Math.round(fbfm40)) : null;
  return {
    fuel_type: {
      fbfm40_code: fbfm40,
      description: fuelInfo?.description ?? null,
      fire_behavior: fuelInfo?.fire_behavior ?? null,
    },
    risk_forecast: {
      run_date: runDate,
      max_impacted_structures: Math.round(maxImpacted),
      is_active: maxImpacted > 0,
    },
    source: "Pyrecast/Pyregence — ELMFIRE model, LANDFIRE 2.5.0 (open access)",
  };
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------
export function genasysUrl(lat: number, lng: number): string {
  return `https://protect.genasys.com/search?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
}

export const LOCAL_ALERTS_URL = "https://www.ready.gov/alerts";
export const WATCH_DUTY_URL = "https://www.watchduty.org";
export const AIRNOW_FIRE_MAP = "https://fire.airnow.gov/";

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message, status }, status);
}
