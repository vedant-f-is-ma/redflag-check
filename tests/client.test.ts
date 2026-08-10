import { test, expect, describe } from "bun:test";
import { esc, niceMiles, geoMapSVG, mapOverlay, demoRing, demoVerdict, buddyBannerState } from "../public/lib.js";

const STATES = ["in_zone", "downwind_threat", "adjacent", "safe_tonight"];

describe("esc", () => {
  test("escapes < > & and coerces non-strings", () => {
    expect(esc("<a> & </a>")).toBe("&lt;a&gt; &amp; &lt;/a&gt;");
    expect(esc("plain")).toBe("plain");
    expect(esc(123)).toBe("123");
  });
});

describe("niceMiles", () => {
  test("rounds down to a nice step", () => {
    expect(niceMiles(4)).toBe(3);
    expect(niceMiles(0.1)).toBe(0.25);
    expect(niceMiles(100)).toBe(75);
    expect(niceMiles(12)).toBe(10);
  });
});

describe("demoRing", () => {
  test("returns a closed ring of [lng,lat] points for every state", () => {
    for (const s of STATES) {
      const ring = demoRing(s);
      expect(ring.length).toBe(15); // 14 + closing point
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    }
  });
});

describe("demoVerdict", () => {
  test("each state yields a verdict + checklist + drawable ring", () => {
    for (const s of STATES) {
      const d = demoVerdict(s);
      expect(d.verdict.state).toBe(s);
      expect(d.verdict.nearest_polygon.ring.length).toBeGreaterThan(3);
      expect(d.action_checklist.do_now.length).toBeGreaterThan(0);
      expect(d.action_checklist.do_not.length).toBeGreaterThan(0);
      expect(d.location.matched_address).toContain("DEMO");
      expect(d.links.watch_duty).toContain("watchduty");
    }
  });
  test("unknown state falls back to safe_tonight", () => {
    expect(demoVerdict("bogus").verdict.state).toBe("safe_tonight");
  });
  // The fail-safe state, previewable via ?demo=data_unavailable (so the outage banner
  // can be reviewed/filmed without waiting for a real NWS outage).
  test("data_unavailable demo simulates a full outage: degraded, no geometry, honest checklist", () => {
    const d = demoVerdict("data_unavailable");
    expect(d.verdict.state).toBe("data_unavailable");
    expect(d.verdict.headline).toContain("unreachable");
    expect(d.verdict.nearest_polygon).toBeNull();      // nothing drawable during an outage
    expect(d.data_status.degraded).toBe(true);
    expect(d.action_checklist.category).toBe("data_unavailable");
    expect(d.action_checklist.do_not.join(" ")).toContain("Do NOT assume you are clear");
    expect(d.fire_context).toBeNull();                 // no "live" ELMFIRE claims in an outage demo
  });
  test("healthy demo states report a clean data_status (freshness line stays green)", () => {
    for (const s of STATES) {
      expect(demoVerdict(s).data_status.degraded).toBe(false);
    }
  });
});

describe("demoVerdict downwind tiers", () => {
  const TIER_STATES = ["downwind_red", "downwind_orange", "downwind_yellow"];
  test("each tier demo key maps to the real downwind_threat state with its tier set", () => {
    for (const s of TIER_STATES) {
      const d = demoVerdict(s);
      expect(d.verdict.state).toBe("downwind_threat");
      expect(d.verdict.downwind.triggered).toBe(true);
      expect(d.verdict.downwind.tier).toBe(s.replace("downwind_", ""));
      expect(d.action_checklist.category).toBe("adjacent");
      expect(d.action_checklist.do_now.length).toBeGreaterThan(0);
      expect(d.verdict.nearest_polygon.ring.length).toBeGreaterThan(3);
    }
  });
  test("demoRing renders a valid ring for each tier state", () => {
    for (const s of TIER_STATES) {
      const ring = demoRing(s);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    }
  });
});

describe("geoMapSVG", () => {
  const verdict = demoVerdict("downwind_threat").verdict;
  const location = { lat: 37.7, lng: -122.0 };
  test("renders an SVG with the polygon, YOU marker, and a scale bar", () => {
    const svg = geoMapSVG(verdict, location, "area");
    expect(svg).toContain("<svg");
    expect(svg).toContain("geomap-poly");
    expect(svg).toContain("YOU");
    expect(svg).toContain(" mi</text>");
  });
  test("every zoom level renders", () => {
    for (const z of ["wide", "area", "close", "closer"]) {
      expect(geoMapSVG(verdict, location, z)).toContain("<svg");
    }
  });
  test("empty when there's no ring or a bad location", () => {
    expect(geoMapSVG({ nearest_polygon: null }, location, "area")).toBe("");
    expect(geoMapSVG(verdict, { lat: NaN, lng: NaN }, "area")).toBe("");
    expect(geoMapSVG({ nearest_polygon: { ring: [[0, 0]] } }, location, "area")).toBe("");
  });
});

describe("mapOverlay", () => {
  const verdict = demoVerdict("downwind_threat").verdict; // wind NE 35mph, fire 8mi NE
  test("at close/closer zoom, draws wind arrow + fire direction + wind label", () => {
    for (const z of ["close", "closer"]) {
      const ov = mapOverlay([320, 210], verdict, z);
      expect(ov).toContain("geomap-overlay");
      expect(ov).toContain("mapwind-line");
      expect(ov).toContain("fire 8 mi NE");
      expect(ov).toContain("winds NE");
    }
  });
  test("at wide/area zoom, suppresses the fire indicator (real polygon is already on-frame) but keeps wind", () => {
    for (const z of ["wide", "area", undefined]) {
      const ov = mapOverlay([320, 210], verdict, z);
      expect(ov).not.toContain("fire 8 mi NE");
      expect(ov).not.toContain("mapfire-line");
      expect(ov).toContain("mapwind-line");
      expect(ov).toContain("winds NE");
    }
  });
  test("in_zone (distance 0) skips the fire-direction arrow even at close zoom", () => {
    const ov = mapOverlay([320, 210], demoVerdict("in_zone").verdict, "close");
    expect(ov).not.toContain("fire 0 mi");
    expect(ov).toContain("mapwind-line"); // wind still drawn
  });
  test("empty for bad input or no wind/fire", () => {
    expect(mapOverlay(null, verdict, "close")).toBe("");
    expect(mapOverlay([320, 210], { wind_vector: null, nearest_polygon: null }, "close")).toBe("");
  });
});

describe("buddyBannerState", () => {
  test("reports the zone when NWS answered", () => {
    expect(buddyBannerState({ in_red_flag_zone: true, data_unavailable: false }, true)).toBe("in_zone");
    expect(buddyBannerState({ in_red_flag_zone: false, data_unavailable: false }, true)).toBe("outside");
  });

  test("an NWS outage is 'unverified', never the reassuring 'outside' branch", () => {
    // in_red_flag_zone is null here; anything that tests it before
    // data_unavailable lands on "outside" and tells the sender their friend is
    // clear of a warning nobody managed to look up.
    expect(buddyBannerState({ in_red_flag_zone: null, data_unavailable: true }, true)).toBe("unverified");
  });

  test("an address that failed to geocode is not reported as 'no address given'", () => {
    expect(buddyBannerState(null, true)).toBe("lookup_failed");
    expect(buddyBannerState(undefined, true)).toBe("lookup_failed");
  });

  test("no address entered keeps the neutral prompt", () => {
    expect(buddyBannerState(null, false)).toBe("no_address");
  });

  test("no state claims a zone result unless one was actually returned", () => {
    for (const entered of [true, false]) {
      expect(["lookup_failed", "no_address"]).toContain(buddyBannerState(null, entered));
    }
  });
});

// renderBuddyResult looks its banner up by the key buddyBannerState returns, so a
// typo on either side renders a literal "undefined" where a warning belongs. The
// in_zone banner is the one that matters most and the one a unit test of the
// selector alone would not catch.
test("every banner state buddyBannerState can return exists in index.html", async () => {
  const html = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
  const literal = html.match(/const BUDDY_BANNERS = \{[\s\S]*?\n  \};/)?.[0];
  expect(literal).toBeTruthy();
  const states = [
    buddyBannerState({ in_red_flag_zone: true, data_unavailable: false }, true),
    buddyBannerState({ in_red_flag_zone: false, data_unavailable: false }, true),
    buddyBannerState({ in_red_flag_zone: null, data_unavailable: true }, true),
    buddyBannerState(null, true),
    buddyBannerState(null, false),
  ];
  expect(new Set(states).size).toBe(5); // no two inputs collapse to the same banner
  for (const s of states) expect(literal).toContain(`\n    ${s}: \``);
});
