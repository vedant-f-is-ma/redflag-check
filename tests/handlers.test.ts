import { test, expect, describe, afterEach } from "bun:test";
import zoneCheck from "../api/v1/zone-check";
import schoolStatus from "../api/v1/school-status";
import schools from "../api/v1/schools";
import status from "../api/v1/status";
import autocomplete from "../api/v1/autocomplete";
import staticMap from "../api/v1/static-map";
import buddyTemplate from "../api/v1/buddy-template";
import welcome from "../api/v1/welcome";
import health from "../api/v1/health";
import { SCHOOLS, findSchool } from "../api/_schools";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.GEOAPIFY_API_KEY; });

function routeFetch(routes: Record<string, any>) {
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    for (const [pat, val] of Object.entries(routes)) {
      if (url.includes(pat)) {
        if (val === "ERR") return new Response("err", { status: 500 });
        return new Response(JSON.stringify(val), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 200 });
  }) as any;
}

const NWS_POINTS = { properties: { forecastHourly: "https://api.weather.gov/hourly-x" } };
const NWS_HOURLY = { properties: { periods: [{ startTime: "t", endTime: "t2", temperature: 70, windSpeed: "30 mph", windDirection: "NE", relativeHumidity: { value: 15 }, shortForecast: "Windy" }] } };
const EMPTY = { features: [] };
const CENSUS_MATCH = { result: { addressMatches: [{ coordinates: { x: -122.27, y: 37.87 }, matchedAddress: "1980 ALLSTON WAY, BERKELEY", addressComponents: { zip: "94704" } }] } };
const baseForecast = { "/points/": NWS_POINTS, "hourly-x": NWS_HOURLY };
const req = (path: string, init?: any) => new Request("https://redflag-check.info" + path, init);

describe("zone-check", () => {
  test("address path returns a verdict; no map without a provider key", async () => {
    delete process.env.GEOAPIFY_API_KEY;
    routeFetch({ "geocoding.geo.census.gov": CENSUS_MATCH, "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, ...baseForecast });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=1980+Allston"))).json();
    expect(d.verdict.state).toBe("safe_tonight");
    expect(d.location.matched_address).toContain("ALLSTON");
    expect(d.map_views).toBeNull();
  });
  test("safe result still gets a user-centered map (marker, no polygon) when a key is set", async () => {
    process.env.GEOAPIFY_API_KEY = "k";
    routeFetch({ "geocoding.geo.census.gov": CENSUS_MATCH, "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, ...baseForecast });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=1980+Allston"))).json();
    expect(d.verdict.state).toBe("safe_tonight");
    expect(d.map_views).not.toBeNull();
    expect(d.map_views.area.urls[0]).toContain("marker=");
    expect(d.map_views.area.urls[0]).not.toContain("geometry=polygon");
  });
  test("lat/lng path reverse-geocodes a label with a key", async () => {
    process.env.GEOAPIFY_API_KEY = "k";
    routeFetch({ "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, ...baseForecast, "geoapify.com/v1/geocode/reverse": { results: [{ street: "Skyline Blvd", city: "Oakland" }] } });
    const d = await (await zoneCheck(req("/api/v1/zone-check?lat=37.8&lng=-122.18"))).json();
    expect(d.location.matched_address).toBe("near Skyline Blvd, Oakland");
  });
  test("lat/lng out-of-zone: reverse-geocoded state restores nearest/adjacency", async () => {
    // The point isn't in a warning, but a warning sits ~4 mi away. Geolocation users
    // must still get the "adjacent / stay alert" signal — this regressed when the
    // verdict stopped fetching CA polygons unconditionally; the reverse-geocoded
    // state now scopes the regional fetch on the lat/lng path.
    process.env.GEOAPIFY_API_KEY = "k";
    routeFetch({
      "alerts/active?point": EMPTY,
      "geoapify.com/v1/geocode/reverse": { results: [{ street: "Skyline Blvd", city: "Oakland", state_code: "CA" }] },
      "alerts/active?area": { features: [
        { id: "near", properties: { event: "Red Flag Warning", areaDesc: "Hills" }, geometry: { type: "Polygon", coordinates: [[[-122.10, 37.78], [-122.06, 37.78], [-122.06, 37.82], [-122.10, 37.82], [-122.10, 37.78]]] } },
      ] },
      "/points/": NWS_POINTS,
      "hourly-x": { properties: { periods: [{ startTime: "t", endTime: "t2", temperature: 65, windSpeed: "8 mph", windDirection: "W", relativeHumidity: { value: 40 }, shortForecast: "Calm" }] } },
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?lat=37.8&lng=-122.18"))).json();
    expect(d.verdict.state).toBe("adjacent");
    expect(d.verdict.nearest_polygon).not.toBeNull();
  });
  test("no params -> 400, bad geocode -> 422, bad coords -> 422", async () => {
    expect((await zoneCheck(req("/api/v1/zone-check"))).status).toBe(400);
    routeFetch({ "geocoding.geo.census.gov": { result: { addressMatches: [] } } });
    expect((await zoneCheck(req("/api/v1/zone-check?address=nowhere"))).status).toBe(422);
    expect((await zoneCheck(req("/api/v1/zone-check?lat=abc&lng=xyz"))).status).toBe(422);
  });

  // --- Regression: non-California zone-based (UGC-only) Red Flag Warning. ---
  // Live 2026-06-28, NWS had 26 active RFWs in AZ/NM/CO, all geometry:null/UGC-only,
  // and addresses inside them (e.g. Winslow, AZ) returned safe_tonight because the
  // verdict only consulted California polygons. The point query DID see the warning.
  const WINSLOW_CENSUS = { result: { addressMatches: [{ coordinates: { x: -110.6974, y: 35.0242 }, matchedAddress: "WINSLOW, AZ", addressComponents: { zip: "86047", state: "AZ" } }] } };
  const AZ_ZONE_RING = [[-111.0, 34.7], [-110.4, 34.7], [-110.4, 35.3], [-111.0, 35.3], [-111.0, 34.7]]; // contains Winslow
  const AZ_POINT_RFW = { features: [
    { id: "az-rfw", properties: { event: "Red Flag Warning", headline: "RFW Little Colorado River Valley in Navajo County", areaDesc: "Little Colorado River Valley in Navajo County", geocode: { UGC: ["AZZ113"] } }, geometry: null },
  ] };

  test("non-CA zone-based RFW at the address reads in_zone (was safe_tonight)", async () => {
    routeFetch({
      "geocoding.geo.census.gov": WINSLOW_CENSUS,
      "alerts/active?point": AZ_POINT_RFW,
      "zones/fire/AZZ113": { geometry: { type: "Polygon", coordinates: [AZ_ZONE_RING] } },
      ...baseForecast,
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=Winslow+AZ"))).json();
    expect(d.verdict.state).toBe("in_zone");
    expect(d.in_red_flag_zone).toBe(true);
    expect(d.verdict.nearest_polygon).not.toBeNull();      // geometry resolved -> map can draw
    expect(d.verdict.nearest_polygon.source).toBe("zone");
    expect(d.alerts.length).toBe(1);
  });
  test("lat/lng inside a zone-based RFW reads in_zone", async () => {
    routeFetch({
      "alerts/active?point": AZ_POINT_RFW,
      "zones/fire/AZZ113": { geometry: { type: "Polygon", coordinates: [AZ_ZONE_RING] } },
      ...baseForecast,
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?lat=35.0242&lng=-110.6974"))).json();
    expect(d.verdict.state).toBe("in_zone");
    expect(d.in_red_flag_zone).toBe(true);
  });
  test("safety backstop: in_zone holds even if zone geometry fails to resolve", async () => {
    routeFetch({
      "geocoding.geo.census.gov": WINSLOW_CENSUS,
      "alerts/active?point": AZ_POINT_RFW,
      "zones/fire/AZZ113": "ERR",   // geometry resolution down — must NOT gate the verdict
      ...baseForecast,
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=Winslow+AZ"))).json();
    expect(d.verdict.state).toBe("in_zone");
    expect(d.in_red_flag_zone).toBe(true);
    expect(d.verdict.nearest_polygon).toBeNull(); // no geometry, but still flagged
  });
  test("out-of-zone: regional fetch scoped to the geocoded state finds the nearest warning", async () => {
    routeFetch({
      "geocoding.geo.census.gov": WINSLOW_CENSUS,   // AZ, at Winslow
      "alerts/active?point": EMPTY,                  // point itself not in a warning
      "alerts/active?area": { features: [           // but AZ has a warning ~150mi away
        { id: "az-far", properties: { event: "Red Flag Warning", areaDesc: "Far AZ zone" }, geometry: { type: "Polygon", coordinates: [[[-112.1, 32.9], [-111.9, 32.9], [-111.9, 33.1], [-112.1, 33.1], [-112.1, 32.9]]] } },
      ] },
      ...baseForecast,
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=Winslow+AZ"))).json();
    expect(d.verdict.state).toBe("safe_tonight");
    expect(d.verdict.nearest_polygon).not.toBeNull();        // distance/bearing computed nationwide
    expect(d.verdict.nearest_polygon.source).toBe("polygon");
  });
});

describe("school-status", () => {
  test("valid id returns verdict + decision", async () => {
    routeFetch({ "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, ...baseForecast });
    const d = await (await schoolStatus(req("/api/v1/school-status?id=" + SCHOOLS[0].id))).json();
    expect(d.verdict).toBeDefined();
    expect(d.location.matched_address).toContain(SCHOOLS[0].name);
    expect(d.decision_recommendation.level).toBeDefined();
  });
  test("no id -> 400, unknown -> 404", async () => {
    expect((await schoolStatus(req("/api/v1/school-status"))).status).toBe(400);
    expect((await schoolStatus(req("/api/v1/school-status?id=nope"))).status).toBe(404);
  });
  test("in-zone + high wind drives a stronger decision", async () => {
    routeFetch({
      "alerts/active?point": { features: [{ id: "x", properties: { event: "Red Flag Warning", areaDesc: "Hills" } }] },
      "alerts/active?area": EMPTY,
      "/points/": NWS_POINTS,
      "hourly-x": { properties: { periods: [{ startTime: "t", endTime: "t2", temperature: 70, windSpeed: "45 mph", windDirection: "NE", relativeHumidity: { value: 10 }, shortForecast: "Windy" }] } },
    });
    const d = await (await schoolStatus(req("/api/v1/school-status?id=" + SCHOOLS[0].id))).json();
    expect(d.in_red_flag_zone).toBe(true);
    expect(d.decision_recommendation.level).toBe("indoors_only");
  });
});

describe("schools + _schools", () => {
  test("returns alphabetically sorted list", async () => {
    const d = await (await schools(req("/api/v1/schools"))).json();
    const names = d.schools.map((s: any) => s.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    expect(d.count).toBe(SCHOOLS.length);
  });
  test("findSchool by id", () => {
    expect(findSchool(SCHOOLS[0].id)?.id).toBe(SCHOOLS[0].id);
    expect(findSchool("nope")).toBeUndefined();
  });
});

describe("status", () => {
  test("returns active warnings", async () => {
    routeFetch({ "alerts/active": { features: [{ id: "p", properties: { event: "Red Flag Warning", headline: "h", areaDesc: "Hills; Valley" } }] } });
    const d = await (await status(req("/api/v1/status?area=CA"))).json();
    expect(d.count).toBe(1);
    expect(d.active_red_flag_warnings[0].affected_areas).toEqual(["Hills", "Valley"]);
  });
  test("upstream error -> 502", async () => {
    routeFetch({ "alerts/active": "ERR" });
    expect((await status(req("/api/v1/status"))).status).toBe(502);
  });
});

describe("autocomplete", () => {
  test("short text -> empty, no key -> empty", async () => {
    expect((await (await autocomplete(req("/api/v1/autocomplete?text=ab"))).json()).suggestions).toEqual([]);
    expect((await (await autocomplete(req("/api/v1/autocomplete?text=1980 Allston"))).json()).suggestions).toEqual([]);
  });
  test("with key returns filtered suggestions", async () => {
    process.env.GEOAPIFY_API_KEY = "k";
    routeFetch({ "geoapify.com/v1/geocode/autocomplete": { results: [{ formatted: "1980 Allston Way, Berkeley", lat: 37.86, lon: -122.27 }, { formatted: "no-coords" }] } });
    const d = await (await autocomplete(req("/api/v1/autocomplete?text=1980 Allston"))).json();
    expect(d.suggestions).toEqual([{ formatted: "1980 Allston Way, Berkeley", lat: 37.86, lng: -122.27 }]);
  });
  test("upstream error -> empty", async () => {
    process.env.GEOAPIFY_API_KEY = "k";
    routeFetch({ "geoapify.com/v1/geocode/autocomplete": "ERR" });
    expect((await (await autocomplete(req("/api/v1/autocomplete?text=1980 Allston"))).json()).suggestions).toEqual([]);
  });
});

describe("static-map", () => {
  test("OPTIONS -> 204, non-POST -> 405, bad JSON -> 400, missing coords -> 400", async () => {
    expect((await staticMap(req("/api/v1/static-map", { method: "OPTIONS" }))).status).toBe(204);
    expect((await staticMap(req("/api/v1/static-map"))).status).toBe(405);
    expect((await staticMap(req("/api/v1/static-map", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await staticMap(req("/api/v1/static-map", { method: "POST", body: "{}" }))).status).toBe(400);
  });
  test("valid POST returns map_views", async () => {
    const r = await staticMap(req("/api/v1/static-map", { method: "POST", body: JSON.stringify({ lat: 37.8, lng: -122.0, nearest: null }) }));
    expect(r.status).toBe(200);
    expect((await r.json()).map_views).toBeNull();
  });
});

describe("buddy-template", () => {
  test("default generates templates", async () => {
    const d = await (await buddyTemplate(req("/api/v1/buddy-template?name=Jane"))).json();
    expect(d.name).toBe("Jane");
    expect(d.sms_link).toContain("sms:");
    expect(d.ics_content).toContain("BEGIN:VCALENDAR");
    expect(d.mailto_link).toContain("mailto:");
    expect(d.friend_zone_status).toBeNull();
  });
  test("invalid time -> 422", async () => {
    expect((await buddyTemplate(req("/api/v1/buddy-template?time=notatime"))).status).toBe(422);
  });
  test("explicit time + friend coords returns zone status", async () => {
    routeFetch({ "alerts/active": { features: [{ id: "a", properties: { event: "Red Flag Warning", areaDesc: "X" } }] } });
    const d = await (await buddyTemplate(req("/api/v1/buddy-template?name=Jo&time=2026-06-20T05:30:00Z&friend_lat=37.8&friend_lng=-122.18"))).json();
    expect(d.friend_zone_status.in_red_flag_zone).toBe(true);
  });
  test("non-finite friend coords are ignored", async () => {
    const d = await (await buddyTemplate(req("/api/v1/buddy-template?friend_lat=abc&friend_lng=def"))).json();
    expect(d.friend_zone_status).toBeNull();
  });
});

describe("welcome + health", () => {
  test("welcome returns the API doc", async () => {
    const d = await (await welcome(req("/api/v1"))).json();
    expect(d.name).toContain("redflag-check");
    expect(d.endpoints["GET /zone-check"]).toBeDefined();
  });
  test("health reports ok when upstreams respond", async () => {
    globalThis.fetch = (async () => new Response("", { status: 200 })) as any;
    const d = await (await health(req("/api/v1/health"))).json();
    expect(d.status).toBe("ok");
    expect(d.upstreams.nws.ok).toBe(true);
  });
  test("health marks upstreams down when fetch throws", async () => {
    globalThis.fetch = (async () => { throw new Error("down"); }) as any;
    const d = await (await health(req("/api/v1/health"))).json();
    expect(d.upstreams.nws.ok).toBe(false);
    expect(d.upstreams.nws.status).toBe(0);
  });
});

describe("branch coverage", () => {
  const hillsSchool = SCHOOLS.find((s) => s.zone_class === "hills")!;
  const flatsSchool = SCHOOLS.find((s) => s.zone_class === "flats")!;
  const calmHourly = { properties: { periods: [{ startTime: "t", endTime: "t2", temperature: 65, windSpeed: "8 mph", windDirection: "W", relativeHumidity: { value: 40 }, shortForecast: "Calm" }] } };

  test("zone-check in_zone runs the alert filters", async () => {
    routeFetch({
      "geocoding.geo.census.gov": CENSUS_MATCH, // 37.87, -122.27
      "alerts/active?point": { features: [
        { id: "u", properties: { event: "Red Flag Warning", headline: "h", areaDesc: "Hills" } },
        { id: "o", properties: { event: "Heat Advisory", headline: "x", areaDesc: "Y" } },
      ] },
      "alerts/active?area": { features: [{ id: "poly", properties: { event: "Red Flag Warning", areaDesc: "Hills" }, geometry: { type: "Polygon", coordinates: [[[-122.37, 37.77], [-122.17, 37.77], [-122.17, 37.97], [-122.37, 37.97], [-122.37, 37.77]]] } }] },
      ...baseForecast,
    });
    const d = await (await zoneCheck(req("/api/v1/zone-check?address=1980+Allston"))).json();
    expect(d.verdict.state).toBe("in_zone");
    expect(d.alerts.length).toBe(1);
    expect(d.other_alerts.length).toBe(1);
  });

  test("school decision: modify_outdoor on high wind", async () => {
    routeFetch({ "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, "/points/": NWS_POINTS, "hourly-x": { properties: { periods: [{ startTime: "t", endTime: "t2", temperature: 70, windSpeed: "40 mph", windDirection: "NE", relativeHumidity: { value: 30 }, shortForecast: "Windy" }] } } });
    const d = await (await schoolStatus(req("/api/v1/school-status?id=" + flatsSchool.id))).json();
    expect(d.decision_recommendation.level).toBe("modify_outdoor");
  });
  test("school decision: normal at a hills campus on a calm night", async () => {
    routeFetch({ "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, "/points/": NWS_POINTS, "hourly-x": calmHourly });
    const d = await (await schoolStatus(req("/api/v1/school-status?id=" + hillsSchool.id))).json();
    expect(d.decision_recommendation.level).toBe("normal");
  });
  test("school decision: normal at a flats campus on a calm night", async () => {
    routeFetch({ "alerts/active?point": EMPTY, "alerts/active?area": EMPTY, "/points/": NWS_POINTS, "hourly-x": calmHourly });
    const d = await (await schoolStatus(req("/api/v1/school-status?id=" + flatsSchool.id))).json();
    expect(d.decision_recommendation.level).toBe("normal");
  });
  test("autocomplete: fetch throws -> empty", async () => {
    process.env.GEOAPIFY_API_KEY = "k";
    globalThis.fetch = (async () => { throw new Error("net"); }) as any;
    expect((await (await autocomplete(req("/api/v1/autocomplete?text=1980 Allston"))).json()).suggestions).toEqual([]);
  });
});
