// GET /api/v1/schools — server-side school lookup (replaces the old full-list dump).
//
//   ?lat=<x>&lng=<y>[&radius_mi=<n>]  -> schools within radius, nearest first, each
//                                        with distance_mi. Default radius 10 mi.
//                                        Auto-expands (rural) until >= MIN_RESULTS or
//                                        MAX_RADIUS; caps (dense) at MAX_RESULTS.
//   ?q=<text>                         -> name/city/district search across all CA
//                                        public schools (for open-enrollment / magnet /
//                                        boarding cases where the nearest isn't the one).
//   (no params)                       -> the curated, individually-verified list only
//                                        (backward compatible; does NOT ship the ~10.5k
//                                        bulk set to the client).
//
// Filtering is done server-side against ALL_SCHOOLS so the full dataset never goes
// over the wire. Both paths return records carrying the same `id` used by
// /api/v1/school-status.

import { jsonResponse, errorResponse, haversineMiles } from "../_lib";
import { SCHOOLS, ALL_SCHOOLS } from "../_schools";

export const config = { runtime: "edge" };

const DEFAULT_RADIUS_MI = 10;
const MAX_RADIUS_MI = 60;   // auto-expand ceiling for rural areas
const MIN_RESULTS = 3;      // expand until at least this many are found
const MAX_RESULTS = 50;     // cap for dense urban areas
const SEARCH_LIMIT = 25;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");

  // ---- Name search (independent of distance) ----
  if (q !== null && q.trim() !== "") {
    const needle = q.trim().toLowerCase();
    const tokens = needle.split(/\s+/).filter(Boolean);
    // Every token must appear somewhere in name + city, in any order — so a natural
    // query like "Chula Vista High" still finds "Chula Vista Senior High" (naive
    // whole-string substring matching would miss it). District is intentionally not
    // matched: "... High School District" would inject "high" into every school in
    // the district, so a "Chula Vista High" search would also surface middle/adult
    // schools. Matching name + city keeps results aligned with what users type.
    const matches = ALL_SCHOOLS.filter((s) => {
      const hay = `${s.name} ${s.city}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    // Rank: whole-query name matches first, then name starts-with the first token,
    // then alphabetical.
    matches.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const as = an.includes(needle) ? 0 : an.startsWith(tokens[0]) ? 1 : 2;
      const bs = bn.includes(needle) ? 0 : bn.startsWith(tokens[0]) ? 1 : 2;
      return as - bs || a.name.localeCompare(b.name);
    });
    return jsonResponse({
      mode: "search",
      query: { q },
      count: Math.min(matches.length, SEARCH_LIMIT),
      total_matches: matches.length,
      capped: matches.length > SEARCH_LIMIT,
      schools: matches.slice(0, SEARCH_LIMIT),
      generated_at: new Date().toISOString(),
    });
  }

  // ---- Radius query ----
  if (latRaw !== null && lngRaw !== null) {
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return errorResponse("lat and lng must be finite numbers.", 400);
    }
    const requested = parseFloat(url.searchParams.get("radius_mi") || "");
    let radius = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_RADIUS_MI) : DEFAULT_RADIUS_MI;
    const requestedRadius = radius;

    const ranked = ALL_SCHOOLS
      .map((s) => ({ s, d: haversineMiles(lat, lng, s.lat, s.lng) }))
      .sort((a, b) => a.d - b.d);

    let withinRadius = ranked.filter((x) => x.d <= radius);
    let autoExpanded = false;
    // Rural: grow the radius until we have a few results (or hit the ceiling).
    while (withinRadius.length < MIN_RESULTS && radius < MAX_RADIUS_MI) {
      radius = Math.min(radius * 2, MAX_RADIUS_MI);
      withinRadius = ranked.filter((x) => x.d <= radius);
      autoExpanded = true;
    }
    const capped = withinRadius.length > MAX_RESULTS;
    const schools = withinRadius.slice(0, MAX_RESULTS).map((x) => ({ ...x.s, distance_mi: +x.d.toFixed(2) }));

    return jsonResponse({
      mode: "radius",
      query: { lat, lng, radius_mi: requestedRadius },
      applied_radius_mi: radius,
      auto_expanded: autoExpanded,
      capped,
      count: schools.length,
      total_within_radius: withinRadius.length,
      schools,
      generated_at: new Date().toISOString(),
    });
  }

  // ---- No params: the curated list only (backward compatible). ----
  const curated = [...SCHOOLS].sort((a, b) => a.name.localeCompare(b.name));
  return jsonResponse({
    mode: "curated",
    note:
      "Add ?lat=&lng=[&radius_mi=] for nearby schools, or ?q= to search all California " +
      "public schools. With no parameters this returns only the individually-verified curated set.",
    count: curated.length,
    schools: curated,
    generated_at: new Date().toISOString(),
  });
}
