// POST /api/v1/static-map
// Body: { lat: number, lng: number, nearest: NearestPolygonInfo | null }
// Returns: { map_views }  (the {wide, area, close} static-map image URLs, or null)
//
// Builds static-map image URLs for an arbitrary user point + nearest-polygon
// geometry. The server holds the provider key, so this lets the client render the
// real basemap for geometry it already has — used by demo mode to show the map
// without an active Red Flag Warning.

import { buildStaticMapUrls, jsonResponse, errorResponse } from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") return errorResponse("POST a JSON body { lat, lng, nearest }.", 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return errorResponse("Numeric lat and lng are required.", 400);
  }

  const map_views = buildStaticMapUrls(lat, lng, body?.nearest ?? null);
  return jsonResponse({ map_views });
}
