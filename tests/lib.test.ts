import { test, expect, describe, afterEach } from "bun:test";
import {
  geocodeAddress, reverseGeocode, fetchAlertsAtPoint, fetchForecastSummary,
  fetchActiveRedFlagPolygons, haversineMiles, bearingDeg, bearingToCompass,
  compassToBearing, angularDiff, pointInPolygon, pointToPolygonNearest,
  classifyVerdict, buildActionChecklist, simplifyRing, buildStaticMapUrls,
  genasysUrl, jsonResponse, errorResponse, USER_AGENT,
  type RedFlagPolygon, type ForecastSummary,
} from "../api/_lib";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.GEOAPIFY_API_KEY; });

function mockFetch(handler: (url: string) => any) {
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const r = handler(url);
    if (r === "ERR") return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
}

const squareRing = (cLat: number, cLng: number, h: number): number[][] =>
  [[cLng - h, cLat - h], [cLng + h, cLat - h], [cLng + h, cLat + h], [cLng - h, cLat + h], [cLng - h, cLat - h]];
const poly = (id: string, ring: number[][]): RedFlagPolygon => ({
  id, event: "Red Flag Warning", headline: "RFW " + id, description: "", instruction: null,
  starts: "", ends: "", expires: "", severity: "", sender_name: "", areas: [], rings: [ring],
});
const fc = (dir: string, mph: number): ForecastSummary => ({
  next_24h: [{ start_iso: "", end_iso: "", temp_f: 70, wind_speed_mph_max: mph, wind_direction: dir, humidity_pct: 20, short_forecast: "Windy" }],
  tonight: { max_wind_mph: mph, min_humidity_pct: 20, summary: "Windy" },
});

describe("geometry helpers", () => {
  test("haversineMiles between SF and Berkeley ~10mi", () => {
    expect(haversineMiles(37.7749, -122.4194, 37.8715, -122.273)).toBeGreaterThan(8);
    expect(haversineMiles(37.7749, -122.4194, 37.8715, -122.273)).toBeLessThan(14);
  });
  test("bearingDeg points east", () => {
    expect(bearingDeg(37.8, -122.2, 37.8, -122.0)).toBeCloseTo(90, 0);
  });
  test("bearingToCompass cardinal points", () => {
    expect(bearingToCompass(0)).toBe("N");
    expect(bearingToCompass(45)).toBe("NE");
    expect(bearingToCompass(180)).toBe("S");
    expect(bearingToCompass(270)).toBe("W");
  });
  test("compassToBearing inverts; unknown -> null", () => {
    expect(compassToBearing("NE")).toBe(45);
    expect(compassToBearing("s")).toBe(180);
    expect(compassToBearing("")).toBeNull();
    expect(compassToBearing("XYZ")).toBeNull();
  });
  test("angularDiff wraps", () => {
    expect(angularDiff(10, 350)).toBe(20);
    expect(angularDiff(0, 180)).toBe(180);
    expect(angularDiff(90, 90)).toBe(0);
  });
  test("pointInPolygon inside vs outside", () => {
    const ring = squareRing(37.8, -122.0, 0.1);
    expect(pointInPolygon(37.8, -122.0, ring)).toBe(true);
    expect(pointInPolygon(37.8, -121.0, ring)).toBe(false);
  });
  test("pointToPolygonNearest gives distance + nearest point; empty -> Infinity", () => {
    const ring = squareRing(37.8, -122.0, 0.1);
    const near = pointToPolygonNearest(37.8, -121.5, ring);
    expect(near.distance_mi).toBeGreaterThan(0);
    expect(Number.isFinite(near.nearest_lat)).toBe(true);
    expect(pointToPolygonNearest(37.8, -122.0, []).distance_mi).toBe(Infinity);
    // ring with a zero-length (repeated) segment exercises the degenerate branch
    const degenerate = [[-122.0, 37.8], [-122.0, 37.8], [-121.9, 37.8], [-121.9, 37.9], [-122.0, 37.8]];
    expect(Number.isFinite(pointToPolygonNearest(37.85, -121.95, degenerate).distance_mi)).toBe(true);
  });
  test("simplifyRing keeps small, decimates large", () => {
    const small = squareRing(37.8, -122.0, 0.1);
    expect(simplifyRing(small)).toBe(small);
    const big: number[][] = Array.from({ length: 500 }, (_, i) => [-122 + i * 0.001, 37.8]);
    const out = simplifyRing(big, 50);
    expect(out.length).toBeLessThanOrEqual(52);
    expect(out[out.length - 1]).toEqual(big[big.length - 1]);
  });
});

describe("classifyVerdict", () => {
  test("in_zone when inside a polygon", () => {
    const p = poly("a", squareRing(37.8, -122.0, 0.05));
    const v = classifyVerdict(37.8, -122.0, [p], fc("NE", 30));
    expect(v.state).toBe("in_zone");
    expect(v.nearest_polygon).not.toBeNull();
  });
  test("downwind_threat when wind comes from the polygon direction", () => {
    const p = poly("ne", squareRing(37.8, -121.85, 0.03)); // NE of user
    const v = classifyVerdict(37.7, -122.0, [p], fc("NE", 35));
    expect(v.state).toBe("downwind_threat");
    expect(v.downwind.triggered).toBe(true);
    expect(["high", "moderate", "low"]).toContain(v.downwind.threat_level);
  });
  test("adjacent when close but wind not aligned", () => {
    const p = poly("ne", squareRing(37.73, -121.96, 0.005)); // ~3mi NE
    const v = classifyVerdict(37.7, -122.0, [p], fc("SW", 30)); // wind blowing away
    expect(v.state).toBe("adjacent");
  });
  test("safe_tonight when polygon is far", () => {
    const p = poly("far", squareRing(38.4, -122.0, 0.05)); // ~48mi N
    const v = classifyVerdict(37.7, -122.0, [p], fc("N", 30));
    expect(v.state).toBe("safe_tonight");
  });
  test("safe_tonight + null nearest when no polygons", () => {
    const v = classifyVerdict(37.7, -122.0, [], fc("N", 5));
    expect(v.state).toBe("safe_tonight");
    expect(v.nearest_polygon).toBeNull();
  });
  test("light wind near a polygon does not trigger downwind", () => {
    const p = poly("ne", squareRing(37.8, -121.85, 0.03));
    const v = classifyVerdict(37.7, -122.0, [p], fc("NE", 5)); // below 15mph
    expect(v.downwind.triggered).toBe(false);
  });
  test("handles missing forecast (no wind vector)", () => {
    const p = poly("ne", squareRing(37.73, -121.96, 0.005));
    const v = classifyVerdict(37.7, -122.0, [p], null);
    expect(v.wind_vector).toBeNull();
    expect(["adjacent", "safe_tonight"]).toContain(v.state);
  });
});

describe("buildActionChecklist", () => {
  test("in_zone category", () => {
    const c = buildActionChecklist(true, false);
    expect(c.category).toBe("in_zone");
    expect(c.do_now.length).toBeGreaterThan(0);
    expect(c.do_not.length).toBeGreaterThan(0);
  });
  test("adjacent category", () => {
    expect(buildActionChecklist(false, true).category).toBe("adjacent");
  });
  test("out_of_zone category", () => {
    expect(buildActionChecklist(false, false).category).toBe("out_of_zone");
  });
});

describe("buildStaticMapUrls", () => {
  const nearest = {
    polygon_id: "x", polygon_headline: "h", distance_mi: 8, bearing_to_polygon_deg: 45,
    bearing_to_polygon_compass: "NE", nearest_lat: 37.8, nearest_lng: -121.9,
    ring: squareRing(37.8, -121.9, 0.05),
  };
  test("null without a key", () => {
    expect(buildStaticMapUrls(37.7, -122.0, nearest)).toBeNull();
  });
  test("null when no ring / far / missing", () => {
    process.env.GEOAPIFY_API_KEY = "k";
    expect(buildStaticMapUrls(37.7, -122.0, null)).toBeNull();
    expect(buildStaticMapUrls(37.7, -122.0, { ...nearest, distance_mi: 99 })).toBeNull();
    expect(buildStaticMapUrls(37.7, -122.0, { ...nearest, ring: [[0, 0]] })).toBeNull();
  });
  test("four zoom views with the key in each url", () => {
    process.env.GEOAPIFY_API_KEY = "secretkey";
    const v = buildStaticMapUrls(37.7, -122.0, nearest)!;
    expect(Object.keys(v).sort()).toEqual(["area", "close", "closer", "wide"]);
    for (const k of ["wide", "area", "close", "closer"] as const) {
      expect(v[k].urls[0]).toContain("apiKey=secretkey");
      expect(v[k].urls[0]).toContain("geometry=polygon");
      expect(Array.isArray(v[k].you_px)).toBe(true);
    }
  });
});

describe("response + url helpers", () => {
  test("genasysUrl formats lat/lon", () => {
    expect(genasysUrl(37.8, -122.2)).toContain("lat=37.80000");
  });
  test("jsonResponse sets CORS + status", async () => {
    const r = jsonResponse({ ok: 1 }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await r.json()).toEqual({ ok: 1 });
  });
  test("errorResponse wraps message", async () => {
    const r = errorResponse("bad", 422);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: "bad", status: 422 });
  });
  test("USER_AGENT is a non-empty string", () => {
    expect(typeof USER_AGENT).toBe("string");
    expect(USER_AGENT.length).toBeGreaterThan(0);
  });
});

describe("fetch-backed helpers", () => {
  test("geocodeAddress maps a Census match", async () => {
    mockFetch(() => ({ result: { addressMatches: [{ coordinates: { x: -122.27, y: 37.87 }, matchedAddress: "1980 ALLSTON WAY, BERKELEY", addressComponents: { zip: "94704" } }] } }));
    const g = await geocodeAddress("1980 Allston Way");
    expect(g).toEqual({ lat: 37.87, lng: -122.27, matched_address: "1980 ALLSTON WAY, BERKELEY", zip: "94704" });
  });
  test("geocodeAddress returns null on no match / error", async () => {
    mockFetch(() => ({ result: { addressMatches: [] } }));
    expect(await geocodeAddress("nowhere")).toBeNull();
    mockFetch(() => "ERR");
    expect(await geocodeAddress("x")).toBeNull();
  });
  test("reverseGeocode returns a 'near' label / null without key", async () => {
    expect(await reverseGeocode(37.8, -122.2)).toBeNull(); // no key
    process.env.GEOAPIFY_API_KEY = "k";
    mockFetch(() => ({ results: [{ street: "Skyline Blvd", city: "Oakland", formatted: "x" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toBe("near Skyline Blvd, Oakland");
    mockFetch(() => ({ results: [{ city: "Oakland" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toBe("near Oakland");
    mockFetch(() => ({ results: [{ formatted: "Somewhere, CA" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toBe("near Somewhere, CA");
    mockFetch(() => ({ results: [{}] }));
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
    mockFetch(() => "ERR");
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
    globalThis.fetch = (async () => { throw new Error("network"); }) as any;
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
  });
  test("fetchAlertsAtPoint maps features", async () => {
    mockFetch(() => ({ features: [{ id: "u1", properties: { event: "Red Flag Warning", headline: "h", areaDesc: "A; B" } }] }));
    const a = await fetchAlertsAtPoint(37.8, -122.2);
    expect(a.length).toBe(1);
    expect(a[0].event).toBe("Red Flag Warning");
    expect(a[0].areas).toEqual(["A", "B"]);
    mockFetch(() => "ERR");
    expect(await fetchAlertsAtPoint(37.8, -122.2)).toEqual([]);
  });
  test("fetchForecastSummary two-step", async () => {
    mockFetch((url) => {
      if (url.includes("/points/")) return { properties: { forecastHourly: "https://api.weather.gov/hourly" } };
      return { properties: { periods: [
        { startTime: "t0", endTime: "t1", temperature: 70, windSpeed: "10 to 20 mph", windDirection: "NE", relativeHumidity: { value: 18 }, shortForecast: "Windy" },
        { startTime: "t1", endTime: "t2", temperature: 68, windSpeed: "30 mph", windDirection: "NE", relativeHumidity: { value: 15 }, shortForecast: "Windy" },
      ] } };
    });
    const f = await fetchForecastSummary(37.8, -122.2);
    expect(f).not.toBeNull();
    expect(f!.tonight.max_wind_mph).toBe(30);
    expect(f!.next_24h.length).toBe(2);
    mockFetch(() => "ERR");
    expect(await fetchForecastSummary(37.8, -122.2)).toBeNull();
  });
  test("fetchActiveRedFlagPolygons parses Polygon + MultiPolygon", async () => {
    mockFetch(() => ({ features: [
      { id: "p1", properties: { event: "Red Flag Warning", areaDesc: "Hills" }, geometry: { type: "Polygon", coordinates: [squareRing(37.8, -122.0, 0.1)] } },
      { id: "p2", properties: { event: "Red Flag Warning", areaDesc: "" }, geometry: { type: "MultiPolygon", coordinates: [[squareRing(38.0, -122.0, 0.1)]] } },
      { id: "p3", properties: {}, geometry: null },
      { id: "p4", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
    ] }));
    const polys = await fetchActiveRedFlagPolygons("CA");
    expect(polys.length).toBe(2);
    expect(polys[0].rings[0].length).toBeGreaterThan(3);
    mockFetch(() => "ERR");
    expect(await fetchActiveRedFlagPolygons("CA")).toEqual([]);
  });
});
