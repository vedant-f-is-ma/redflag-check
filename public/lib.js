// Pure, side-effect-free rendering + demo helpers, extracted from the inline page
// script so they can be unit-tested (Bun) and reused by both the address and school
// result paths. No DOM, no fetch, no top-level work, safe to import anywhere.

export const esc = (s) => String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// Pick a round number <= x for the scale-bar length.
export function niceMiles(x) {
  const steps = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 75];
  let best = steps[0];
  for (const s of steps) if (s <= x) best = s;
  return best;
}

// SVG geo-map: draws the ACTUAL nearest Red Flag Warning polygon outline + the user's
// location + a scale bar, projected from real lat/lng (equirectangular, north-up). No
// map tiles, so it always renders even if a tile server is down.
export function geoMapSVG(verdict, location, zoomLevel) {
  const nearest = verdict && verdict.nearest_polygon;
  const ring = nearest && Array.isArray(nearest.ring) && nearest.ring.length >= 3 ? nearest.ring : null;
  if (!ring || !location || !isFinite(location.lat) || !isFinite(location.lng)) return "";

  const uLat = location.lat, uLng = location.lng;

  let minLat = uLat, maxLat = uLat, minLng = uLng, maxLng = uLng;
  for (const pt of ring) {
    const lng = pt[0], lat = pt[1];
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  const zf = zoomLevel === "wide" ? 2.2 : zoomLevel === "close" ? 0.4 : zoomLevel === "closer" ? 0.22 : 1.0;
  const padLat = Math.max((maxLat - minLat) * 0.12 * zf, 0.01);
  const padLng = Math.max((maxLng - minLng) * 0.12 * zf, 0.01);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  const centerLat = (minLat + maxLat) / 2;
  const cosC = Math.cos(centerLat * Math.PI / 180);
  const worldW = (maxLng - minLng) * cosC;
  const worldH = (maxLat - minLat);
  if (!(worldW > 0) || !(worldH > 0)) return "";

  const VW = 340, VHmax = 440, pad = 16;
  const availW = VW - 2 * pad, availHmax = VHmax - 2 * pad;
  const scale = Math.min(availW / worldW, availHmax / worldH);
  const drawW = worldW * scale, drawH = worldH * scale;
  const VH = drawH + 2 * pad;
  const offX = pad + (availW - drawW) / 2;
  const offY = pad;
  const DEG2MI = 69.0;

  const projX = (lng) => offX + ((lng - minLng) * cosC) * scale;
  const projY = (lat) => offY + (maxLat - lat) * scale;

  let dPath = "", cLatSum = 0, cLngSum = 0;
  ring.forEach((pt, i) => {
    dPath += (i === 0 ? "M" : "L") + projX(pt[0]).toFixed(1) + " " + projY(pt[1]).toFixed(1) + " ";
    cLngSum += pt[0]; cLatSum += pt[1];
  });
  dPath += "Z";
  const cx = projX(cLngSum / ring.length), cy = projY(cLatSum / ring.length);
  const ux = projX(uLng), uy = projY(uLat);

  const miPerPx = DEG2MI / scale;
  const barMi = niceMiles(availW * 0.30 * miPerPx);
  const barPx = (barMi / DEG2MI) * scale;
  const barY = VH - 11, barX0 = pad, barX1 = pad + barPx;

  const ariaLabel = "Map of the active Red Flag Warning area near your address, drawn from the official NWS polygon. Your location is marked YOU. Scale bar shows " + barMi + " miles.";

  return `
    <svg viewBox="0 0 ${VW} ${VH.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" style="max-width:${VW}px;width:100%;display:block;margin:0 auto;" role="img" aria-label="${esc(ariaLabel)}">
      <rect width="${VW}" height="${VH.toFixed(0)}" class="compass-svg-bg" rx="14"/>
      <path d="${dPath.trim()}" class="geomap-poly"/>
      <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dy=".35em" font-size="20">🔥</text>
      <g transform="translate(${VW - 24}, 18)">
        <path d="M0,-6 L5,6 L0,2 L-5,6 Z" class="geomap-n-arrow"/>
        <text x="0" y="20" text-anchor="middle" font-size="12" class="geomap-n-label">N</text>
      </g>
      <circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="7" class="geomap-user-dot"/>
      <text x="${ux.toFixed(1)}" y="${(uy - 12).toFixed(1)}" text-anchor="middle" font-size="11" class="geomap-user-label">YOU</text>
      <line x1="${barX0}" y1="${barY}" x2="${barX1.toFixed(1)}" y2="${barY}" class="geomap-scale-line"/>
      <line x1="${barX0}" y1="${barY - 4}" x2="${barX0}" y2="${barY + 4}" class="geomap-scale-line"/>
      <line x1="${barX1.toFixed(1)}" y1="${barY - 4}" x2="${barX1.toFixed(1)}" y2="${(barY + 4)}" class="geomap-scale-line"/>
      <text x="${(barX1 + 6).toFixed(1)}" y="${(barY + 4).toFixed(1)}" font-size="12" class="geomap-scale-label">${barMi} mi</text>
    </svg>
  `;
}

// SVG overlay drawn on the map image (anchored at the address = image center). Always
// shows the wind direction (blue, toward you). Also shows the fire/warning direction
// (red 🔥, at a fixed pixel radius, NOT the real polygon geometry) but only at
// "close"/"closer" zoom, where the actual polygon is off-frame by design (see
// buildStaticMapUrls: those zooms start from the polygon-fitting zoom + 4/+6 levels
// in). At "wide"/"area" the real polygon is already drawn on the basemap from its
// true coordinates, so the fixed-radius fire icon can visibly disagree with it
// (looks like it's floating outside the polygon) — suppress it there and let the
// real, accurate shape speak for itself.
export function mapOverlay(youPx, verdict, zoomLevel) {
  if (!Array.isArray(youPx)) return "";
  const W = 640, H = 420, cx = youPx[0], cy = youPx[1];
  const rad = (deg) => ((deg - 90) * Math.PI) / 180;
  const wind = verdict.wind_vector, np = verdict.nearest_polygon;
  const showFireIndicator = zoomLevel === "close" || zoomLevel === "closer";
  let parts = "";

  if (showFireIndicator && np && np.bearing_to_polygon_deg !== null && np.bearing_to_polygon_deg !== undefined && isFinite(np.distance_mi) && np.distance_mi >= 1.5) {
    const fb = rad(np.bearing_to_polygon_deg);
    const R = 0.40 * Math.min(W, H);
    let fx = cx + R * Math.cos(fb), fy = cy + R * Math.sin(fb);
    fx = Math.max(46, Math.min(W - 46, fx)); fy = Math.max(40, Math.min(H - 48, fy));
    const lbl = `fire ${Math.round(np.distance_mi)} mi ${esc(np.bearing_to_polygon_compass || "")}`;
    const lw = Math.max(96, lbl.length * 7.2);
    parts += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${fy.toFixed(1)}" class="mapfire-line" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>
      <text x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" text-anchor="middle" dy=".35em" font-size="27">🔥</text>
      <g transform="translate(${fx.toFixed(1)},${(fy + 25).toFixed(1)})"><rect x="${(-lw/2).toFixed(0)}" y="-12" width="${lw.toFixed(0)}" height="22" rx="8" class="mapinfo-pill"/><text x="0" y="4" text-anchor="middle" font-size="12.5" class="mapfire-label">${lbl}</text></g>`;
  }

  if (wind && wind.wind_from_deg !== null && wind.wind_from_deg !== undefined) {
    const fr = rad(wind.wind_from_deg), tv = rad(wind.wind_from_deg + 180), L = 82;
    const tx = cx + L * Math.cos(fr), ty = cy + L * Math.sin(fr);
    const hx = cx + 16 * Math.cos(tv), hy = cy + 16 * Math.sin(tv);
    const bx = hx - 18 * Math.cos(tv), by = hy - 18 * Math.sin(tv);
    const pp = tv + Math.PI / 2;
    const blx = bx + 11 * Math.cos(pp), bly = by + 11 * Math.sin(pp);
    const brx = bx - 11 * Math.cos(pp), bry = by - 11 * Math.sin(pp);
    parts += `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="mapwind-line" stroke-width="5" stroke-linecap="round" stroke-dasharray="9 5"/>
      <polygon points="${hx.toFixed(1)},${hy.toFixed(1)} ${blx.toFixed(1)},${bly.toFixed(1)} ${brx.toFixed(1)},${bry.toFixed(1)}" class="mapwind-head"/>`;
  }

  if (wind && wind.wind_from_compass) {
    const lbl = `winds ${esc(wind.wind_from_compass)} · ${Math.round(wind.wind_speed_mph_peak || 0)} mph`;
    // Text is left-aligned at x=11 (not centered), so the rect needs the measured text
    // width PLUS matching padding on both sides, not just a per-char guess of the text
    // alone. 8.6px/char is calibrated against canvas.measureText() for this bold 14px
    // label font across compass labels up to "WNW"/"SSW" (the widest realistic case,
    // 3-letter intercardinal directions); the flat 7.6px/char + no-padding version this
    // replaces under-measured those and let the text overflow the pill.
    const lw = Math.max(130, lbl.length * 8.6 + 22);
    parts += `<g transform="translate(12,12)"><rect x="0" y="0" width="${lw.toFixed(0)}" height="26" rx="9" class="mapinfo-pill"/><text x="11" y="18" font-size="14" class="mapwind-label">${lbl}</text></g>`;
  }

  if (!parts) return "";
  return `<svg class="geomap-overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${parts}</svg>`;
}

// Downwind tiers (red/orange/yellow), per Ian Moore/SIG feedback 2026-07-13: distance
// within the same downwind cone changes the dominant risk (flame vs. smoke). Demo-mode
// distances chosen to sit clearly inside each tier band (see DOWNWIND_TIER_*_MAX_MI in
// api/_lib.ts: red <=5mi, orange <=15mi, yellow <=25mi).
const DOWNWIND_TIER_DEMO_DISTANCE_MI = { downwind_red: 3, downwind_orange: 10, downwind_threat: 8, downwind_yellow: 20 };

// Synthetic warning-area ring for demo mode (so ?demo= states show the geo-map).
export function demoRing(state) {
  const uLat = 37.7, uLng = -122.0, DEG = 69.0;
  const distMi = state === "in_zone" ? 0
    : state === "adjacent" ? 3
    : DOWNWIND_TIER_DEMO_DISTANCE_MI[state] !== undefined ? DOWNWIND_TIER_DEMO_DISTANCE_MI[state]
    : 18;
  const bearing = 45 * Math.PI / 180; // NE
  let cLat, cLng, rMi;
  if (state === "in_zone") {
    cLat = uLat + 0.03; cLng = uLng + 0.035; rMi = 7;
  } else {
    const isDownwind = state === "adjacent" || DOWNWIND_TIER_DEMO_DISTANCE_MI[state] !== undefined;
    const centerDist = distMi + (state === "adjacent" ? 2.5 : 4);
    cLat = uLat + (centerDist / DEG) * Math.cos(bearing);
    cLng = uLng + (centerDist / (DEG * Math.cos(uLat * Math.PI / 180))) * Math.sin(bearing);
    rMi = state === "safe_tonight" ? 6 : isDownwind ? 3.5 : 6;
  }
  const cosLat = Math.cos(cLat * Math.PI / 180), pts = [], n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const wob = 0.72 + 0.5 * Math.abs(Math.sin(2.5 * a + 1));
    pts.push([cLng + ((rMi * wob) / (DEG * cosLat)) * Math.cos(a), cLat + ((rMi * wob) / DEG) * Math.sin(a)]);
  }
  pts.push(pts[0].slice());
  return pts;
}

export function demoVerdict(state) {
  const wind = { wind_from_compass: "NE", wind_from_deg: 45, wind_to_compass: "SW", wind_to_deg: 225, wind_speed_mph_peak: 35 };
  const np = {
    polygon_id: "demo",
    polygon_headline: "Red Flag Warning issued for your area",
    distance_mi: state === "in_zone" ? 0
      : state === "adjacent" ? 3
      : DOWNWIND_TIER_DEMO_DISTANCE_MI[state] !== undefined ? DOWNWIND_TIER_DEMO_DISTANCE_MI[state]
      : 18,
    bearing_to_polygon_deg: 45,
    bearing_to_polygon_compass: "NE",
    nearest_lat: 37.78,
    nearest_lng: -122.18,
    ring: demoRing(state),
  };
  const states = {
    in_zone: {
      state: "in_zone",
      headline: "Your address is inside the active Red Flag Warning.",
      short_explanation: "Take action tonight: prepare a go-bag and be ready to leave if instructed.",
      nearest_polygon: np,
      wind_vector: wind,
      downwind: { triggered: false, alignment_angle_deg: null, threat_level: "none", tier: null, explanation: "" },
    },
    downwind_threat: {
      state: "downwind_threat",
      headline: "Elevated fire and smoke threat headed your way over the next day or two.",
      short_explanation: "Active warning is 8 mi NE of you. Tonight's wind is from the NE at 35 mph. Expect elevated fire and smoke conditions over the next day or two. Prepare a go-bag and monitor official updates.",
      nearest_polygon: np,
      wind_vector: wind,
      downwind: { triggered: true, alignment_angle_deg: 0, threat_level: "high", tier: "orange", explanation: "" },
    },
    downwind_red: {
      state: "downwind_threat",
      headline: "High fire threat: wind is pushing fire conditions toward your address tonight.",
      short_explanation: "Active warning is 3 mi NE of you. Tonight's wind is from the NE at 35 mph. Be ready to evacuate or follow local emergency instructions immediately.",
      nearest_polygon: np,
      wind_vector: wind,
      downwind: { triggered: true, alignment_angle_deg: 0, threat_level: "high", tier: "red", explanation: "" },
    },
    downwind_orange: {
      state: "downwind_threat",
      headline: "Elevated fire and smoke threat headed your way over the next day or two.",
      short_explanation: "Active warning is 10 mi NE of you. Tonight's wind is from the NE at 35 mph. Expect elevated fire and smoke conditions over the next day or two. Prepare a go-bag and monitor official updates.",
      nearest_polygon: np,
      wind_vector: wind,
      downwind: { triggered: true, alignment_angle_deg: 0, threat_level: "moderate", tier: "orange", explanation: "" },
    },
    downwind_yellow: {
      state: "downwind_threat",
      headline: "Smoke and air quality risk from a warning area upwind of you.",
      short_explanation: "Active warning is 20 mi NE of you. Tonight's wind is from the NE at 35 mph. Smoke and air quality impacts are the main concern right now. Direct fire threat is lower in the short term, but conditions can change quickly.",
      nearest_polygon: np,
      wind_vector: wind,
      downwind: { triggered: true, alignment_angle_deg: 0, threat_level: "low", tier: "yellow", explanation: "" },
    },
    adjacent: {
      state: "adjacent",
      headline: "You're near the active warning. Stay alert.",
      short_explanation: "Nearest active warning is 3 mi NE of you. Conditions could shift.",
      nearest_polygon: np,
      wind_vector: { ...wind, wind_from_compass: "SW", wind_from_deg: 225, wind_to_deg: 45, wind_to_compass: "NE", wind_speed_mph_peak: 12 },
      downwind: { triggered: false, alignment_angle_deg: 180, threat_level: "none", tier: null, explanation: "" },
    },
    safe_tonight: {
      state: "safe_tonight",
      headline: "You're in a safer area tonight.",
      short_explanation: "Active warning is 18 mi away and wind is blowing fire conditions away from you.",
      nearest_polygon: np,
      wind_vector: { ...wind, wind_from_compass: "SW", wind_from_deg: 225, wind_to_deg: 45, wind_to_compass: "NE", wind_speed_mph_peak: 14 },
      downwind: { triggered: false, alignment_angle_deg: 180, threat_level: "none", tier: null, explanation: "" },
    },
  };
  const verdict = states[state] || states.safe_tonight;
  const effState = verdict.state; // demo tier keys (downwind_red/orange/yellow) map to the real "downwind_threat" state
  return {
    location: { lat: 37.7, lng: -122.0, matched_address: "DEMO ADDRESS, FREMONT, CA", zip: "94538" },
    verdict,
    action_checklist: {
      category: effState === "in_zone" ? "in_zone" : (effState === "downwind_threat" || effState === "adjacent") ? "adjacent" : "out_of_zone",
      do_now: effState === "in_zone"
        ? ["Charge your phone. Keep car keys near the door.", "Park your car facing OUTWARD on the driveway.", "Pack a go-bag: meds, IDs, phone charger, water, sturdy shoes.", "Set a buddy to text-check you at 11 PM tonight."]
        : effState === "downwind_threat"
        ? ["Treat tonight as if you were inside the warning polygon.", "Keep your phone charged and bring it to bed with sound on.", "Park car facing outward. Pack a go-bag.", "Set a buddy to text-check you tonight."]
        : effState === "adjacent"
        ? ["Keep your phone charged and bring it to bed with sound on.", "Sign up for your county's emergency alerts if you haven't.", "Know your Genasys zone in case conditions change."]
        : ["Tonight is not a wind-driven fire-weather event for your address.", "Fire-season preparedness still matters.", "Text a neighbor in the hills. They may be in the active polygon."],
      do_not: effState === "in_zone" || effState === "downwind_threat"
        ? ["Do NOT mow dry grass.", "Do NOT use BBQs or open flames outdoors.", "Do NOT park on dry grass."]
        : ["Avoid sparking activities outdoors during fire season."],
      if_evacuation_called: [],
    },
    links: {
      genasys_evacuation_zone_lookup: "https://protect.genasys.com/search?lat=37.7&lon=-122.0",
      official_ac_alert_signup: "https://www.ready.gov/alerts",
      watch_duty: "https://www.watchduty.org",
      airnow_fire_map: "https://fire.airnow.gov/",
    },
    fire_context: {
      fuel_type: {
        fbfm40_code: 142,
        description: "Shrub (SH2)",
        fire_behavior: "high intensity, strong spotting",
      },
      risk_forecast: {
        run_date: (() => { const d = new Date(); return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}_12`; })(),
        max_impacted_structures: effState === "in_zone" ? 127 : effState === "downwind_threat" ? 89 : effState === "adjacent" ? 23 : 0,
        is_active: effState !== "safe_tonight",
      },
      source: "Pyrecast/Pyregence, ELMFIRE model, LANDFIRE 2.5.0 (open access) [DEMO]",
    },
  };
}
