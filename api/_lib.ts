// Shared helpers: geocoding (US Census), NWS alert/forecast fetching, response shaping.
// All functions are pure and side-effect-free except for outbound HTTP.

const USER_AGENT = "redflag-check.info (vedant28t@gmail.com)";

// ---------------------------------------------------------------------------
// Geocoding (US Census, free, no auth)
// ---------------------------------------------------------------------------
export interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address: string;
  zip?: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
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
  };
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
        "Do NOT drag chains (boat trailers, etc.) — sparks.",
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
        "Your address is adjacent to the active NWS Red Flag Warning polygon.",
        "Wind-driven fires do not stop at polygon boundaries. The 1991 Oakland Hills fire, the 2023 Lahaina fire, and the 2025 Palisades fire all pushed past nominal boundaries in wind events. Treat tonight as a fire-weather night.",
        "Keep your phone charged and bring it to bed with sound on.",
        "Sign up for AC Alert if you haven't (link below).",
        "Know your Genasys zone in case conditions change.",
      ],
      do_not: [
        "Do NOT do anything that throws sparks outdoors tonight.",
        "Avoid driving through East Bay Hills routes if not essential.",
      ],
      if_evacuation_called: [
        "Wind-driven fires move fast. Be ready to leave even if you're adjacent.",
      ],
    };
  }
  return {
    category: "out_of_zone",
    do_now: [
      "Your address is outside the active NWS Red Flag Warning polygon.",
      "Important: this does NOT mean fire-safe. NWS polygons are advisory, not boundaries that stop fire. The 1991 Oakland Hills fire, Lahaina, and the Palisades fire all pushed past nominal boundaries in wind events until they ran out of fuel or hit the ocean. During fire season, keep a go-bag ready regardless of polygon status.",
      "Tonight is still a fire-weather night across the Bay Area. Avoid sparking activities outdoors.",
      "Text a neighbor in the hills — they are in the active polygon and pre-positioning matters most in the next few hours.",
      "Sign up for AC Alert in case conditions expand (link below).",
    ],
    do_not: [
      "Do not assume polygon-outside means safe. A wind-driven fire can reach you even from an active polygon next door.",
    ],
    if_evacuation_called: [
      "If your area becomes affected, check Genasys Protect for your zone (link below).",
    ],
  };
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------
export function genasysUrl(lat: number, lng: number): string {
  return `https://protect.genasys.com/search?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
}

export const ALAMEDA_AC_ALERT_SIGNUP = "https://member.everbridge.net/index/453003085612570";
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
