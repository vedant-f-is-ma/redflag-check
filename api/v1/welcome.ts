// Self-documenting API root.
// Served at /api/v1 via a vercel.json rewrite so anyone who lops the path
// gets a useful response instead of a 404. Browsers render JSON natively;
// the `docs` and `openapi_spec` fields are clickable links to the human UI.

import { jsonResponse } from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(_req: Request): Promise<Response> {
  return jsonResponse({
    name: "redflag-check API",
    version: "v1",
    description:
      "Free, public, no-auth REST API for East Bay Red Flag Warning lookups, " +
      "school decisions, and buddy-check templates. Address-based verdicts powered by " +
      "NWS, US Census, and Genasys.",
    docs: "https://redflag-check.info/docs",
    openapi_spec: "https://redflag-check.info/openapi.yaml",
    source: "https://github.com/vedant-f-is-ma/redflag-check",
    base_url: "https://redflag-check.info/api/v1",
    endpoints: {
      "GET /zone-check":
        "Address or coords -> Red Flag Warning verdict + forecast + action checklist + Genasys zone link.",
      "GET /status":
        "All active Red Flag Warnings in a US state. Defaults to CA.",
      "GET /schools":
        "Catalog of supported East Bay schools (id, name, district, address, lat/lng).",
      "GET /school-status":
        "Per-school decision view with CIF AQI rationale.",
      "GET /buddy-template":
        "Generate iMessage / mailto / .ics buddy-check templates for a neighbor.",
      "GET /health":
        "Service and upstream API status.",
    },
    auth: "none required",
    cors: "open (Access-Control-Allow-Origin: *)",
    cache: "Vercel edge, 60 seconds",
    rate_limit:
      "No hard limit at this tier. If sustained > 1 req/sec, email the maintainer to plan capacity.",
    sources: [
      "NWS api.weather.gov",
      "US Census geocoder",
      "Genasys Protect",
      "BAAQMD AirNow",
    ],
    disclaimer:
      "Informational only. NOT an official emergency service. " +
      "For official alerts, sign up at AC Alert. In case of fire, call 911.",
  });
}
