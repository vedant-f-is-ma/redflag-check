// GET /api/v1/health → simple uptime + upstream-API status check.

import { jsonResponse } from "../_lib";

export const config = { runtime: "edge" };

async function probe(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "redflag-check.vercel.app (vedant28t@gmail.com)" },
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  }
}

export default async function handler(_req: Request): Promise<Response> {
  const [nws, census, genasys] = await Promise.all([
    probe("https://api.weather.gov/"),
    probe("https://geocoding.geo.census.gov/"),
    probe("https://protect.genasys.com/"),
  ]);

  return jsonResponse({
    service: "redflag-check",
    version: "v1",
    status: "ok",
    upstreams: {
      nws: nws,
      census_geocoder: census,
      genasys_protect: genasys,
    },
    timestamp: new Date().toISOString(),
  });
}
