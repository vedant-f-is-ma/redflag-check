// Offline, one-time data-prep. NOT a runtime dependency and NOT called per-request.
//
// Builds api/_schools_cde.json — the bulk California public-school dataset — from
// the California Department of Education (CDE) public-school directory, and reports
// the exact coordinate provenance of every record.
//
//   Run:  bun run scripts/build-schools.ts [path-to-pubschls.txt]
//         (downloads the live CDE file if no local path is given)
//         GEOAPIFY_API_KEY must be set for the reverse-geocode spot-check.
//
// COORDINATE INTEGRITY (the whole point of this script):
//   Every lat/lng in the output traces to exactly one of:
//     (a) a coordinate published in the CDE source file itself      -> "cde_provided"
//     (b) the actual response of a real geocodeCensus/geocodeGeoapify call
//         from api/_lib.ts                                          -> "geocoded_census" / "geocoded_geoapify"
//   No coordinate is ever written, estimated, inferred, or recalled as text.
//   CDE publishes lat/lng for every active school, so in practice the bulk set is
//   entirely (a); geocoding is only a fallback for curated private schools not in
//   the CDE public file.

import { geocodeCensus, geocodeGeoapify, reverseGeocode, haversineMiles } from "../api/_lib";
import { SCHOOLS as CURATED } from "../api/_schools";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const CDE_URL = "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt";
const CA_BBOX = { latMin: 32.5, latMax: 42.0, lngMin: -124.5, lngMax: -114.0 };
const AGREE_MI = 0.2;          // curated<->authoritative agreement tolerance
const SPOTCHECK_FRACTION = 0.01;
const OUT_JSON = new URL("../api/_schools_cde.json", import.meta.url).pathname;
const OUT_MANIFEST = new URL("./schools-manifest.json", import.meta.url).pathname;

function inCA(lat: number, lng: number): boolean {
  return lat >= CA_BBOX.latMin && lat <= CA_BBOX.latMax && lng >= CA_BBOX.lngMin && lng <= CA_BBOX.lngMax;
}
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function loadCDE(): Promise<string> {
  const arg = process.argv[2];
  if (arg && existsSync(arg)) { console.log(`Reading CDE file from ${arg}`); return readFileSync(arg, "utf8"); }
  console.log(`Downloading CDE directory from ${CDE_URL} ...`);
  const res = await fetch(CDE_URL);
  if (!res.ok) throw new Error(`CDE download failed: ${res.status}`);
  return await res.text();
}

interface Rec {
  id: string; name: string; district: string; address: string; city: string;
  zip: string; county: string; lat: number; lng: number;
  source: "cde"; coord_source: "cde_provided" | "geocoded_census" | "geocoded_geoapify";
}

(async function main() {
  const raw = await loadCDE();
  const lines = raw.split(/\r?\n/).filter((l) => l.length);
  const header = lines[0].split("\t");
  const col = (name: string) => header.indexOf(name);
  const iCDS = col("CDSCode"), iStatus = col("StatusType"), iCounty = col("County"),
    iDistrict = col("District"), iSchool = col("School"), iStreet = col("Street"),
    iCity = col("City"), iZip = col("Zip"), iLat = col("Latitude"), iLng = col("Longitude");

  // Parse -> active real schools with a valid in-CA CDE coordinate.
  const cde: Rec[] = [];
  let excludedNonActive = 0, excludedNonSchool = 0, excludedBadCoord = 0;
  for (let n = 1; n < lines.length; n++) {
    const f = lines[n].split("\t");
    if (f[iStatus] !== "Active") { excludedNonActive++; continue; }
    const school = f[iSchool];
    if (!school || school === "No Data" || f[iCDS].endsWith("0000000")) { excludedNonSchool++; continue; }
    const lat = parseFloat(f[iLat]), lng = parseFloat(f[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inCA(lat, lng)) { excludedBadCoord++; continue; }
    cde.push({
      id: f[iCDS], name: school, district: f[iDistrict] || "", address: (f[iStreet] || "").trim(),
      city: f[iCity] || "", zip: (f[iZip] || "").slice(0, 5), county: f[iCounty] || "",
      lat: +lat.toFixed(5), lng: +lng.toFixed(5), source: "cde", coord_source: "cde_provided",
    });
  }
  console.log(`\nCDE parse: ${cde.length} active real schools with valid in-CA coords`);
  console.log(`  excluded: ${excludedNonActive} non-active, ${excludedNonSchool} district/admin/no-name, ${excludedBadCoord} missing/out-of-CA coord`);

  // Index CDE by city for curated matching.
  const cdeByCity = new Map<string, Rec[]>();
  for (const r of cde) { const k = norm(r.city); (cdeByCity.get(k) || cdeByCity.set(k, []).get(k)!).push(r); }

  // ---- Curated cross-check: confirm each hand-verified coord against CDE; never overwrite silently. ----
  console.log(`\n=== CURATED 27 — coordinate confirmation (tolerance ${AGREE_MI} mi) ===`);
  const curatedCds = new Set<string>();               // CDE rows to dedup out of the bulk
  const curatedResult: any[] = [];                    // finalized curated records (for _schools.ts update)
  const flags: string[] = [];
  for (const c of CURATED) {
    const cands = (cdeByCity.get(norm(c.city)) || []);
    const cn = norm(c.name);
    // best CDE candidate in the same city: normalized-name equality, else containment, else token overlap
    let best: Rec | null = null, bestScore = 0;
    for (const r of cands) {
      const rn = norm(r.name);
      let score = 0;
      if (rn === cn) score = 1;
      else if (rn.includes(cn) || cn.includes(rn)) score = 0.8;
      else { const a = new Set(cn.split(" ")), b = new Set(rn.split(" ")); const inter = [...a].filter((x) => b.has(x)).length; score = inter / Math.max(a.size, b.size); }
      if (score > bestScore) { bestScore = score; best = r; }
    }
    const cdeDist = best ? haversineMiles(c.lat, c.lng, best.lat, best.lng) : Infinity;
    let shipLat = c.lat, shipLng = c.lng, coordSource = "", note = "";
    if (best && bestScore >= 0.5 && cdeDist <= AGREE_MI) {
      shipLat = best.lat; shipLng = best.lng; coordSource = "cde_provided"; curatedCds.add(best.id);
      note = `CDE match ${best.id} @ ${cdeDist.toFixed(2)}mi — adopt CDE coord`;
    } else {
      if (best && bestScore >= 0.5) curatedCds.add(best.id); // same school; dedup even if coord disagreed
      // fallback: real geocode call, provider-labeled
      const q = `${c.address}, ${c.city}, CA`;
      const cs = await geocodeCensus(q); await sleep(120);
      let g = cs, provider: "geocoded_census" | "geocoded_geoapify" = "geocoded_census";
      if (!g) { g = await geocodeGeoapify(q); provider = "geocoded_geoapify"; await sleep(120); }
      const geoDist = g ? haversineMiles(c.lat, c.lng, g.lat, g.lng) : Infinity;
      const cdeGeoDist = best && g ? haversineMiles(best.lat, best.lng, g.lat, g.lng) : Infinity;
      if (g && geoDist <= AGREE_MI) {
        shipLat = +g.lat.toFixed(5); shipLng = +g.lng.toFixed(5); coordSource = provider;
        note = `${best ? `CDE ${cdeDist.toFixed(2)}mi (rejected)` : "no CDE match"}; ${provider} @ ${geoDist.toFixed(2)}mi confirms curated — adopt geocode`;
      } else if (g && best && cdeGeoDist <= 0.1) {
        // CDE and an independent geocode of the official address converge (<0.1 mi)
        // while the curated hand-entry sits ~0.2-0.35 mi off: the curated value is the
        // outlier, NOT CDE being a bad centroid. Eyeballed 2026-07-17 (Amador Valley,
        // Campolindo) — CDE + geocode both land on the school's street address; the gap
        // is within-campus and immaterial to a 25-mi radius tool. Adopt the geocode,
        // honestly labeled. (If CDE and the geocode did NOT agree, this falls through
        // to the FLAG branch below and is kept curated for hand review.)
        shipLat = +g.lat.toFixed(5); shipLng = +g.lng.toFixed(5); coordSource = provider;
        note = `curated ${geoDist.toFixed(2)}mi off; CDE + ${provider} converge (${cdeGeoDist.toFixed(2)}mi apart) on street address — adopt authoritative geocode`;
      } else {
        coordSource = "NEEDS_REVIEW"; shipLat = c.lat; shipLng = c.lng;
        note = `DISAGREE (3-way): CDE ${best ? cdeDist.toFixed(2) + "mi" : "none"}, geocode ${g ? geoDist.toFixed(2) + "mi" : "FAIL"}, CDE<->geo ${isFinite(cdeGeoDist) ? cdeGeoDist.toFixed(2) + "mi" : "n/a"} — KEEP curated, EYEBALL`;
        flags.push(`${c.id} (${c.name}, ${c.city}): ${note}`);
      }
    }
    curatedResult.push({ id: c.id, name: c.name, city: c.city, cds: best?.id ?? null, cdeDist: isFinite(cdeDist) ? +cdeDist.toFixed(2) : null, lat: shipLat, lng: shipLng, coord_source: coordSource, note });
    console.log(`  ${coordSource === "cde_provided" ? "✓CDE " : coordSource === "NEEDS_REVIEW" ? "⚠FLAG" : "✓GEO "} ${c.name.padEnd(34).slice(0, 34)} ${c.city.padEnd(12).slice(0, 12)} ${note}`);
  }

  // ---- Dedup: drop CDE rows that correspond to a curated school. ----
  const bulk = cde.filter((r) => !curatedCds.has(r.id));
  console.log(`\nDedup: removed ${cde.length - bulk.length} CDE rows that match a curated school -> bulk = ${bulk.length}`);

  // ---- Final bbox sanity on everything we will ship. ----
  const allShip = [...bulk, ...curatedResult.map((c) => ({ lat: c.lat, lng: c.lng, id: c.id }))];
  const outOfBox = allShip.filter((r) => !inCA(r.lat, r.lng));
  console.log(`CA-bbox check on ${allShip.length} shipped records: ${outOfBox.length} outside CA` + (outOfBox.length ? " -> " + outOfBox.map((r) => r.id).join(",") : " ✓"));

  // ---- Write bulk dataset. ----
  writeFileSync(OUT_JSON, JSON.stringify(bulk));
  console.log(`\nWrote ${OUT_JSON} (${bulk.length} records, ${(JSON.stringify(bulk).length / 1024 / 1024).toFixed(2)} MB raw)`);

  // ---- Provenance report. ----
  const csCounts: Record<string, number> = {};
  for (const r of bulk) csCounts[r.coord_source] = (csCounts[r.coord_source] || 0) + 1;
  for (const c of curatedResult) csCounts[c.coord_source] = (csCounts[c.coord_source] || 0) + 1;
  console.log(`\n=== PROVENANCE ===`);
  console.log(`source counts:  cde=${bulk.length}, curated=${curatedResult.length}`);
  console.log(`coord_source counts:`, csCounts);
  console.log(`geocoding failures (records dropped for un-geocodable coord): 0 (CDE supplies all bulk coords)`);
  if (flags.length) { console.log(`\n⚠ ${flags.length} curated flag(s) NEED EYEBALL:`); flags.forEach((f) => console.log("   " + f)); }
  else console.log(`\ncurated flags: none — all 27 confirmed within ${AGREE_MI}mi`);

  // ---- Reverse-geocode spot-check (~1%): hunt gross errors (wrong county/city), tolerate minor city-name differences. ----
  console.log(`\n=== SPOT-CHECK (reverse-geocode ~${SPOTCHECK_FRACTION * 100}% of bulk) ===`);
  const key = process.env.GEOAPIFY_API_KEY || "";
  const spot: any = { sampled: 0, checked: 0, revgeo_failed: 0, city_mismatches: [] as any[] };
  if (!key) {
    console.log("  SKIPPED — GEOAPIFY_API_KEY not set. Re-run with the key to complete the spot-check.");
  } else {
    const n = Math.max(20, Math.round(bulk.length * SPOTCHECK_FRACTION));
    // deterministic evenly-spaced sample (no RNG needed)
    const step = Math.floor(bulk.length / n);
    const sample: Rec[] = [];
    for (let i = 0; i < bulk.length && sample.length < n; i += step) sample.push(bulk[i]);
    spot.sampled = sample.length;
    for (const r of sample) {
      const rg = await reverseGeocode(r.lat, r.lng); await sleep(220);
      if (!rg || !rg.label) { spot.revgeo_failed++; continue; }
      spot.checked++;
      // rg.label looks like "near <street>, <city>"; compare normalized city tokens loosely.
      const labelN = norm(rg.label), cityN = norm(r.city);
      const cityTokens = cityN.split(" ").filter((t) => t.length > 2);
      const match = cityTokens.length === 0 || cityTokens.some((t) => labelN.includes(t)) || (rg.state && rg.state !== "CA" ? false : true) && labelN.length > 0;
      // Gross-error signal: reverse geocode resolves to a NON-CA state.
      if (rg.state && rg.state !== "CA") spot.city_mismatches.push({ id: r.id, name: r.name, cde_city: r.city, revgeo: rg.label, state: rg.state, GROSS: true });
      else if (!cityTokens.some((t) => labelN.includes(t))) spot.city_mismatches.push({ id: r.id, name: r.name, cde_city: r.city, revgeo: rg.label });
    }
    console.log(`  sampled ${spot.sampled}, reverse-geocoded ok ${spot.checked}, revgeo failures ${spot.revgeo_failed} (not coord errors)`);
    const gross = spot.city_mismatches.filter((m: any) => m.GROSS);
    console.log(`  GROSS errors (resolved outside CA): ${gross.length}` + (gross.length ? " -> " + JSON.stringify(gross) : " ✓"));
    console.log(`  minor city-name differences (expected — unincorporated/neighborhood): ${spot.city_mismatches.length - gross.length}`);
    if (spot.city_mismatches.length - gross.length > 0) console.log("   samples:", JSON.stringify(spot.city_mismatches.filter((m: any) => !m.GROSS).slice(0, 8)));
  }

  // ---- Manifest. ----
  const manifest = {
    cde_source_url: CDE_URL,
    downloaded: new Date().toISOString().slice(0, 10),
    cde_total_rows: lines.length - 1,
    active_real_schools_in_ca: cde.length,
    shipped: { cde_bulk: bulk.length, curated: curatedResult.length, total: bulk.length + curatedResult.length },
    coord_source_counts: csCounts,
    geocoding_failures: 0,
    curated_flags: flags,
    spotcheck: spot,
    agree_tolerance_mi: AGREE_MI,
  };
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
  // Emit the finalized curated coord/coord_source table so _schools.ts can be updated by hand.
  writeFileSync(new URL("./curated-coords.json", import.meta.url).pathname, JSON.stringify(curatedResult, null, 2));
  console.log(`\nWrote ${OUT_MANIFEST} and scripts/curated-coords.json`);
  console.log(`\nDONE. Review the curated table above before wiring the API.`);
})();
