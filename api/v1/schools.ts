// GET /api/v1/schools
// Returns the full list of supported schools with id, name, district, address, lat/lng.

import { jsonResponse } from "../_lib";
import { SCHOOLS } from "../_schools";

export const config = { runtime: "edge" };

export default async function handler(_req: Request): Promise<Response> {
  // Sorted alphabetically by name so the picker is easy to scan.
  const schools = [...SCHOOLS].sort((a, b) => a.name.localeCompare(b.name));
  return jsonResponse({
    count: schools.length,
    schools,
    generated_at: new Date().toISOString(),
  });
}
