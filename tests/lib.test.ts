import { test, expect, describe, afterEach } from "bun:test";
import {
  geocodeAddress, reverseGeocode, fetchAlertsAtPoint, fetchForecastSummary,
  fetchActiveRedFlagPolygons, resolveAlertsToPolygons, haversineMiles, bearingDeg, bearingToCompass,
  compassToBearing, angularDiff, pointInPolygon, pointToPolygonNearest,
  classifyVerdict, buildActionChecklist, simplifyRing, buildStaticMapUrls,
  wgs84ToEPSG3310, fetchPyrecastData,
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
  starts: "", ends: "", expires: "", severity: "", sender_name: "", areas: [], rings: [ring], source: "polygon",
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

// Distance-based sub-tier within a triggered downwind result (Ian Moore/SIG feedback,
// 2026-07-13): red <=5mi, orange <=15mi, yellow <=25mi (same cone as DOWNWIND_MAX_DISTANCE_MI).
describe("classifyVerdict downwind tiers", () => {
  const uLat = 37.7, uLng = -122.0;
  // Places a small (near-point) polygon `distMi` miles NE of the user so tier boundaries
  // can be tested without the polygon's own footprint shifting the nearest-point distance
  // by more than a few tenths of a mile.
  function polygonAtDistance(distMi: number): RedFlagPolygon {
    const DEG = 69.0;
    const rad = (45 * Math.PI) / 180;
    const cLat = uLat + (distMi / DEG) * Math.cos(rad);
    const cLng = uLng + (distMi / (DEG * Math.cos((uLat * Math.PI) / 180))) * Math.sin(rad);
    return poly(`d${distMi}`, squareRing(cLat, cLng, 0.005));
  }
  test("tier is red well within the 5mi boundary", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(3)], fc("NE", 35));
    expect(v.state).toBe("downwind_threat");
    expect(v.downwind.tier).toBe("red");
    expect(v.headline).toContain("High fire threat");
  });
  test("tier is still red just under the 5mi boundary", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(4)], fc("NE", 35));
    expect(v.downwind.tier).toBe("red");
  });
  test("tier is orange just over the 5mi boundary", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(6)], fc("NE", 35));
    expect(v.downwind.tier).toBe("orange");
  });
  test("tier is orange well within the 5-15mi band", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(10)], fc("NE", 35));
    expect(v.downwind.tier).toBe("orange");
    expect(v.headline).toContain("Elevated fire and smoke threat");
  });
  test("tier is still orange just under the 15mi boundary", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(14)], fc("NE", 35));
    expect(v.downwind.tier).toBe("orange");
  });
  test("tier is yellow just over the 15mi boundary", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(16)], fc("NE", 35));
    expect(v.downwind.tier).toBe("yellow");
  });
  test("tier is yellow near the outer 25mi edge of the downwind cone", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(24)], fc("NE", 35));
    expect(v.state).toBe("downwind_threat");
    expect(v.downwind.tier).toBe("yellow");
    expect(v.headline).toContain("Smoke and air quality risk");
  });
  test("tier is null when downwind isn't triggered", () => {
    const v = classifyVerdict(uLat, uLng, [polygonAtDistance(10)], fc("SW", 30)); // wind blowing away
    expect(v.downwind.triggered).toBe(false);
    expect(v.downwind.tier).toBeNull();
  });
  test("tier is null for in_zone (tiering only applies within downwind_threat)", () => {
    const p = poly("a", squareRing(37.8, -122.0, 0.05));
    const v = classifyVerdict(37.8, -122.0, [p], fc("NE", 30));
    expect(v.state).toBe("in_zone");
    expect(v.downwind.tier).toBeNull();
  });
});

// FBFM40 fuel-code mapping, checked against the primary source:
// Scott & Burgan (2005), USDA Forest Service GTR-RMRS-153, Table 3.
// Standard model numbers: NB 91-93/98-99, GR 101-109, GS 121-124, SH 141-149,
// TU 161-165, TL 181-189, SB 201-204.
describe("FBFM40 fuel-code mapping vs Scott & Burgan GTR-RMRS-153", () => {
  const fuelFor = async (code: number) => {
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      const body = url.includes("fbfm40")
        ? `Results for FeatureType 'fbfm40':\nGRAY_INDEX = ${code}.0\n`
        : "Results:\nGRAY_INDEX = 0.0\n";
      return new Response(body, { status: 200 });
    }) as any;
    const d = await fetchPyrecastData(37.8, -122.2);
    return d!.fuel_type.description;
  };

  test("each fuel-type band maps to its correct code prefix", async () => {
    expect(await fuelFor(91)).toBe("Non-burnable");
    expect(await fuelFor(99)).toBe("Non-burnable");
    expect(await fuelFor(101)).toBe("Grass (GR1)");
    expect(await fuelFor(109)).toBe("Grass (GR9)");
    expect(await fuelFor(121)).toBe("Grass-Shrub (GS1)");
    expect(await fuelFor(124)).toBe("Grass-Shrub (GS4)");
    expect(await fuelFor(141)).toBe("Shrub (SH1)");
    expect(await fuelFor(149)).toBe("Shrub (SH9)");
    expect(await fuelFor(161)).toBe("Timber Understory (TU1)");
    expect(await fuelFor(165)).toBe("Timber Understory (TU5)");
    expect(await fuelFor(181)).toBe("Timber Litter (TL1)");
    expect(await fuelFor(189)).toBe("Timber Litter (TL9)");
  });

  // Regression: SB was previously mapped to 191-199, which meant real slash-blowdown
  // models were unrecognised AND TL-block custom codes were mislabelled as SB.
  test("slash-blowdown is 201-204, not 191-199", async () => {
    expect(await fuelFor(201)).toBe("Slash-Blowdown (SB1)");
    expect(await fuelFor(204)).toBe("Slash-Blowdown (SB4)");
    // 191-199 lives in the TL block and is NOT slash-blowdown
    expect(await fuelFor(195)).not.toContain("Slash-Blowdown");
    expect(await fuelFor(195)).toBe("Fuel model 195");
  });

  test("codes outside the standard set fall through honestly", async () => {
    expect(await fuelFor(250)).toBe("Fuel model 250");
    expect(await fuelFor(170)).toBe("Fuel model 170"); // TU custom block, sub-numbering undefined
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
  test("user-centered map (marker, no geometry) when no usable polygon", () => {
    process.env.GEOAPIFY_API_KEY = "k";
    // safe result / polygon too far / invalid ring all fall back to a "here's your area" map
    for (const arg of [null, { ...nearest, distance_mi: 99 }, { ...nearest, ring: [[0, 0]] }]) {
      const v = buildStaticMapUrls(37.7, -122.0, arg as any);
      expect(v).not.toBeNull();
      expect(Object.keys(v!).sort()).toEqual(["area", "close", "closer", "wide"]);
      expect(v!.area.urls[0]).toContain("apiKey=k");
      expect(v!.area.urls[0]).toContain("marker=");
      expect(v!.area.urls[0]).not.toContain("geometry=polygon");
    }
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

describe("wgs84ToEPSG3310", () => {
  test("Oakland Hills matches pyproj reference", () => {
    const { x, y } = wgs84ToEPSG3310(37.85, -122.2);
    expect(x).toBe(-193305);
    expect(y).toBe(-16251);
  });
  test("Malibu reference point", () => {
    const { x, y } = wgs84ToEPSG3310(34.03, -118.78);
    expect(x).toBeCloseTo(112664, -2);
    expect(y).toBeCloseTo(-442114, -2);
  });
});

describe("fetchPyrecastData", () => {
  afterEach(() => { globalThis.fetch = realFetch; });

  test("returns null outside coverage area", async () => {
    expect(await fetchPyrecastData(48.0, -122.0)).toBeNull();  // too far north
    expect(await fetchPyrecastData(37.8, -75.0)).toBeNull();   // East Coast
  });

  test("parses fuel type and risk from WMS responses", async () => {
    globalThis.fetch = (async (input: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      const body = url.includes("fbfm40")
        ? "Results for FeatureType 'fbfm40':\nGRAY_INDEX = 186.0\n"
        : "Results for FeatureType 'impacted-structures':\nGRAY_INDEX = 0.0\n";
      return new Response(body, { status: 200 });
    }) as any;
    const d = await fetchPyrecastData(37.85, -122.2);
    expect(d).not.toBeNull();
    expect(d!.fuel_type.fbfm40_code).toBe(186);
    expect(d!.fuel_type.description).toBe("Timber Litter (TL6)");
    expect(d!.risk_forecast.max_impacted_structures).toBe(0);
    expect(d!.risk_forecast.is_active).toBe(false);
  });

  test("is_active true when any time step > 0", async () => {
    globalThis.fetch = (async (input: any) => {
      const url: string = typeof input === "string" ? input : input.url;
      const body = url.includes("fbfm40")
        ? "GRAY_INDEX = 141.0\n"
        : "GRAY_INDEX = 0.0\nGRAY_INDEX = 0.0\nGRAY_INDEX = 47.0\nGRAY_INDEX = 0.0\n";
      return new Response(body, { status: 200 });
    }) as any;
    const d = await fetchPyrecastData(37.85, -122.2);
    expect(d!.risk_forecast.is_active).toBe(true);
    expect(d!.risk_forecast.max_impacted_structures).toBe(47);
    expect(d!.fuel_type.description).toBe("Shrub (SH1)");
  });

  test("returns null when both fetches fail", async () => {
    globalThis.fetch = (async () => new Response("err", { status: 500 })) as any;
    expect(await fetchPyrecastData(37.85, -122.2)).toBeNull();
  });

  test("handles network errors gracefully", async () => {
    globalThis.fetch = (async () => { throw new Error("network"); }) as any;
    expect(await fetchPyrecastData(37.85, -122.2)).toBeNull();
  });
});

describe("fetch-backed helpers", () => {
  test("geocodeAddress maps a Census match (incl. state)", async () => {
    mockFetch(() => ({ result: { addressMatches: [{ coordinates: { x: -122.27, y: 37.87 }, matchedAddress: "1980 ALLSTON WAY, BERKELEY", addressComponents: { zip: "94704", state: "CA" } }] } }));
    const g = await geocodeAddress("1980 Allston Way");
    expect(g).toEqual({ lat: 37.87, lng: -122.27, matched_address: "1980 ALLSTON WAY, BERKELEY", zip: "94704", state: "CA" });
  });
  test("geocodeAddress returns null on no match / error", async () => {
    mockFetch(() => ({ result: { addressMatches: [] } }));
    expect(await geocodeAddress("nowhere")).toBeNull();
    mockFetch(() => "ERR");
    expect(await geocodeAddress("x")).toBeNull();
  });
  test("geocodeAddress falls back to Geoapify when Census finds nothing", async () => {
    process.env.GEOAPIFY_API_KEY = "testkey";
    mockFetch((url) => {
      if (url.includes("census.gov")) return { result: { addressMatches: [] } };
      return { results: [{ lat: 35.62, lon: -117.67, formatted: "Ridgecrest, CA", postcode: "93555", state_code: "ca" }] };
    });
    const g = await geocodeAddress("Ridgecrest CA");
    expect(g).toEqual({ lat: 35.62, lng: -117.67, matched_address: "Ridgecrest, CA", zip: "93555", state: "CA" });
  });
  test("geocodeAddress Geoapify fallback: empty results -> null", async () => {
    process.env.GEOAPIFY_API_KEY = "testkey";
    mockFetch((url) => {
      if (url.includes("census.gov")) return { result: { addressMatches: [] } };
      return { results: [] };
    });
    expect(await geocodeAddress("nowhere special")).toBeNull();
  });
  test("geocodeAddress Geoapify fallback: upstream error -> null", async () => {
    process.env.GEOAPIFY_API_KEY = "testkey";
    mockFetch((url) => {
      if (url.includes("census.gov")) return { result: { addressMatches: [] } };
      return "ERR";
    });
    expect(await geocodeAddress("nowhere special")).toBeNull();
  });
  test("geocodeAddress Geoapify fallback: network throw -> null", async () => {
    process.env.GEOAPIFY_API_KEY = "testkey";
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("census.gov")) return new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 });
      throw new Error("network");
    }) as any;
    expect(await geocodeAddress("nowhere special")).toBeNull();
  });
  test("reverseGeocode returns a 'near' label + state / null without key", async () => {
    expect(await reverseGeocode(37.8, -122.2)).toBeNull(); // no key
    process.env.GEOAPIFY_API_KEY = "k";
    mockFetch(() => ({ results: [{ street: "Skyline Blvd", city: "Oakland", formatted: "x", state_code: "CA" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toEqual({ label: "near Skyline Blvd, Oakland", state: "CA" });
    // ISO 3166-2 "US-CA" form normalizes to the bare 2-letter code NWS area= expects.
    mockFetch(() => ({ results: [{ city: "Oakland", state_code: "US-CA" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toEqual({ label: "near Oakland", state: "CA" });
    // No state_code -> state undefined, but the label is still built from `formatted`.
    mockFetch(() => ({ results: [{ formatted: "Somewhere, CA" }] }));
    expect(await reverseGeocode(37.8, -122.2)).toEqual({ label: "near Somewhere, CA", state: undefined });
    mockFetch(() => ({ results: [{}] }));
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
    mockFetch(() => "ERR");
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
    globalThis.fetch = (async () => { throw new Error("network"); }) as any;
    expect(await reverseGeocode(37.8, -122.2)).toBeNull();
  });
  test("fetchAlertsAtPoint maps features (incl. UGC zones)", async () => {
    mockFetch(() => ({ features: [{ id: "u1", properties: { event: "Red Flag Warning", headline: "h", areaDesc: "A; B", geocode: { UGC: ["AZZ112", "AZZ113"] } } }] }));
    const a = await fetchAlertsAtPoint(37.8, -122.2);
    expect(a.length).toBe(1);
    expect(a[0].event).toBe("Red Flag Warning");
    expect(a[0].areas).toEqual(["A", "B"]);
    expect(a[0].ugc).toEqual(["AZZ112", "AZZ113"]);
    // Missing geocode block -> empty ugc, not a crash.
    mockFetch(() => ({ features: [{ id: "u2", properties: { event: "Red Flag Warning", areaDesc: "C" } }] }));
    expect((await fetchAlertsAtPoint(37.8, -122.2))[0].ugc).toEqual([]);
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
    expect(polys[0].source).toBe("polygon");
    mockFetch(() => "ERR");
    expect(await fetchActiveRedFlagPolygons("CA")).toEqual([]);
  });
  test("fetchActiveRedFlagPolygons resolves zone boundaries for zone-based alerts", async () => {
    const ring = squareRing(35.6, -117.7, 0.1);
    mockFetch((url) => {
      if (url.includes("alerts/active")) return { features: [
        { id: "z1", properties: { event: "Red Flag Warning", areaDesc: "Indian Wells Valley", geocode: { UGC: ["CAZ298"] } }, geometry: null },
        { id: "z2", properties: { event: "Red Flag Warning", areaDesc: "Empty", geocode: { UGC: [] } }, geometry: null },
      ]};
      if (url.includes("zones/fire/CAZ298")) return { geometry: { type: "Polygon", coordinates: [ring] } };
      return "ERR";
    });
    const polys = await fetchActiveRedFlagPolygons("CA");
    expect(polys.length).toBe(1);
    expect(polys[0].source).toBe("zone");
    expect(polys[0].areas).toEqual(["Indian Wells Valley"]);
    expect(polys[0].rings.length).toBe(1);
  });
  test("fetchActiveRedFlagPolygons handles MultiPolygon zone and failed zone fetch", async () => {
    const ring = squareRing(35.6, -117.7, 0.1);
    mockFetch((url) => {
      if (url.includes("alerts/active")) return { features: [
        { id: "z1", properties: { event: "Red Flag Warning", areaDesc: "Multi", geocode: { UGC: ["CAZ298", "CAZ299"] } }, geometry: null },
        { id: "z2", properties: { event: "Red Flag Warning", areaDesc: "AllFail", geocode: { UGC: ["CAZ999"] } }, geometry: null },
      ]};
      if (url.includes("CAZ298")) return { geometry: { type: "MultiPolygon", coordinates: [[ring]] } };
      if (url.includes("CAZ299")) return { geometry: null };
      return "ERR"; // CAZ999 fails
    });
    const polys = await fetchActiveRedFlagPolygons("CA");
    expect(polys.length).toBe(1);
    expect(polys[0].source).toBe("zone");
    expect(polys[0].rings.length).toBe(1); // only CAZ298 resolved
  });
  test("fetchActiveRedFlagPolygons accepts a multi-state array (comma-joined area)", async () => {
    let requestedUrl = "";
    mockFetch((url) => {
      requestedUrl = url;
      return { features: [
        { id: "az", properties: { event: "Red Flag Warning", areaDesc: "AZ zone" }, geometry: { type: "Polygon", coordinates: [squareRing(35.0, -110.7, 0.1)] } },
      ]};
    });
    const polys = await fetchActiveRedFlagPolygons(["AZ", "NM", "CO"]);
    expect(polys.length).toBe(1);
    // NWS area= takes a comma-separated list; encodeURIComponent renders the comma as %2C.
    expect(requestedUrl).toContain("area=AZ%2CNM%2CCO");
  });

  test("resolveAlertsToPolygons resolves a zone-based point alert to geometry", async () => {
    const ring = squareRing(35.0242, -110.6974, 0.3); // box around Winslow, AZ
    mockFetch((url) => {
      if (url.includes("zones/fire/AZZ113")) return { geometry: { type: "Polygon", coordinates: [ring] } };
      return "ERR";
    });
    const alert = {
      id: "az1", event: "Red Flag Warning", headline: "RFW Little Colorado River Valley",
      description: "", instruction: null, severity: "Severe", certainty: "Likely", urgency: "Expected",
      starts: "", ends: "", expires: "", sender_name: "NWS Flagstaff", areas: ["Navajo County"], ugc: ["AZZ113"],
    };
    const polys = await resolveAlertsToPolygons([alert]);
    expect(polys.length).toBe(1);
    expect(polys[0].source).toBe("zone");
    expect(polys[0].headline).toBe("RFW Little Colorado River Valley");
    // The Winslow point falls inside the resolved zone ring.
    expect(pointInPolygon(35.0242, -110.6974, polys[0].rings[0])).toBe(true);
  });
  test("resolveAlertsToPolygons drops alerts whose zones fail to resolve / have no UGC", async () => {
    mockFetch(() => "ERR"); // every zone fetch fails
    const withUgc = {
      id: "az1", event: "Red Flag Warning", headline: "h", description: "", instruction: null,
      severity: "", certainty: "", urgency: "", starts: "", ends: "", expires: "", sender_name: "", areas: [], ugc: ["AZZ113"],
    };
    const noUgc = { ...withUgc, id: "az2", ugc: [] as string[] };
    expect(await resolveAlertsToPolygons([withUgc, noUgc])).toEqual([]);
  });

  test("classifyVerdict: forceInZone makes a point in_zone even when geometry is missing", async () => {
    // Empty polygon set (zone resolution failed) but the point query saw an RFW.
    const forced = classifyVerdict(35.0242, -110.6974, [], fc("NE", 30), true);
    expect(forced.state).toBe("in_zone");
    expect(forced.nearest_polygon).toBeNull();
    // Without the force signal and no polygons, the same point reads safe.
    expect(classifyVerdict(35.0242, -110.6974, [], fc("NE", 30), false).state).toBe("safe_tonight");
  });
  test("classifyVerdict: forceInZone wins even when the nearest polygon is far away", async () => {
    // Point is NOT inside the (far) polygon, but the point query is authoritative.
    const farPoly = poly("far", squareRing(33.0, -112.0, 0.1));
    const v = classifyVerdict(35.0242, -110.6974, [farPoly], fc("NE", 30), true);
    expect(v.state).toBe("in_zone");
    expect(v.nearest_polygon).not.toBeNull();   // still populated for the map
    expect(v.downwind.triggered).toBe(false);   // no downwind headline on a forced in_zone
  });
});
