import { describe, it, expect } from "bun:test";
import { fetchAlertsAtPoint, resolveAlertsToPolygons, classifyVerdict } from "../api/_lib";

// ---------------------------------------------------------------------------
// LIVE geographic regression for the hardcoded-state bug (in_zone read as
// safe_tonight outside California). Pulls the *current* active NWS Red Flag
// Warnings, finds points GENUINELY INSIDE the warned fire-weather zones (ground
// truth = must read in_zone), and asserts the verdict logic never returns
// safe_tonight for >=10 geographically dispersed points in EVERY state that has
// an active warning.
//
// It mirrors the zone-check handler's in_zone path exactly:
//   fetchAlertsAtPoint -> resolveAlertsToPolygons -> classifyVerdict(forceInZone)
// so a point that NWS reports inside a warning but our logic calls "safe" fails.
//
// Network- and data-dependent (only meaningful while warnings are active), so it
// is OFF by default to keep the core suite deterministic and offline-safe.
//   Run it with:  RUN_LIVE_RFW=1 bun test         (or:  bun run test:live)
// ---------------------------------------------------------------------------

const RUN = process.env.RUN_LIVE_RFW === "1";
const UA = "redflag-check-test (+https://redflag-check.info)";
const TARGET_PER_STATE = 10;

async function getJSON(url: string, accept = "application/json", retries = 5): Promise<any> {
  for (let a = 0; a < retries; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
    }
  }
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function ringsOf(geom: any): number[][][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p: number[][][]) => p[0]);
  return [];
}

// Up to `perZone` dispersed points provably inside the zone (8x8 bbox grid filtered
// by point-in-ring, then evenly subsampled so they spread across the zone).
function interiorPoints(geom: any, perZone: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const ring of ringsOf(geom)) {
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    const mnLng = Math.min(...lngs), mxLng = Math.max(...lngs);
    const mnLat = Math.min(...lats), mxLat = Math.max(...lats);
    const found: Array<[number, number]> = [];
    for (let gi = 1; gi < 9; gi++) {
      for (let gj = 1; gj < 9; gj++) {
        const la = +(mnLat + ((mxLat - mnLat) * gj) / 9).toFixed(4);
        const ln = +(mnLng + ((mxLng - mnLng) * gi) / 9).toFixed(4);
        if (pointInRing(la, ln, ring)) found.push([la, ln]);
      }
    }
    const step = Math.max(1, Math.floor(found.length / perZone));
    for (let i = 0; i < found.length && out.length < perZone; i += step) out.push(found[i]);
  }
  return out;
}

(RUN ? describe : describe.skip)("live: dispersed points inside active Red Flag Warnings read in_zone", () => {
  it(
    ">=10 interior points per active-warning state are never safe_tonight",
    async () => {
      const alerts = await getJSON("https://api.weather.gov/alerts/active?event=Red%20Flag%20Warning");
      const feats: any[] = alerts.features || [];
      if (feats.length === 0) {
        console.warn("[live-rfw] no active Red Flag Warnings right now — nothing to validate (pass)");
        return;
      }

      // group warned fire-weather zones by state
      const zonesByState = new Map<string, Set<string>>();
      for (const f of feats) {
        for (const u of f.properties?.geocode?.UGC ?? []) {
          const st = u.slice(0, 2);
          if (!zonesByState.has(st)) zonesByState.set(st, new Set());
          zonesByState.get(st)!.add(u);
        }
      }

      const failures: string[] = [];
      const thin: string[] = [];
      let checked = 0;

      for (const [st, ugcs] of zonesByState) {
        const pts: Array<[number, number, string]> = [];
        for (const u of [...ugcs].sort()) {
          if (pts.length >= TARGET_PER_STATE + 4) break;
          const ztype = u[2] === "C" ? "county" : "fire";
          let z: any;
          try {
            z = await getJSON(`https://api.weather.gov/zones/${ztype}/${u}`, "application/geo+json");
          } catch {
            continue; // zone geometry unavailable; try the next zone
          }
          for (const [la, ln] of interiorPoints(z.geometry, 3)) pts.push([la, ln, u]);
        }

        const sample = pts.slice(0, Math.max(TARGET_PER_STATE, 10));
        if (sample.length < TARGET_PER_STATE) thin.push(`${st} (${sample.length})`);

        for (const [la, ln, u] of sample) {
          // EXACT handler in_zone path: point query is authoritative; geometry enriches.
          const pointAlerts = await fetchAlertsAtPoint(la, ln);
          const rfw = pointAlerts.filter((a) => a.event === "Red Flag Warning");
          const polys = await resolveAlertsToPolygons(rfw);
          const verdict = classifyVerdict(la, ln, polys, null, rfw.length > 0);
          checked++;
          if (verdict.state !== "in_zone") failures.push(`${st} ${la},${ln} (${u}) -> ${verdict.state}`);
        }
      }

      console.log(
        `[live-rfw] checked ${checked} interior points across ${zonesByState.size} state(s): ${[...zonesByState.keys()].join(", ")}`
      );
      if (thin.length) console.warn(`[live-rfw] states with <${TARGET_PER_STATE} resolvable interior points: ${thin.join(", ")}`);
      if (failures.length) console.error("[live-rfw] MISSES (inside an active warning but not in_zone):\n" + failures.join("\n"));

      expect(failures).toEqual([]);
    },
    300_000
  );
});
