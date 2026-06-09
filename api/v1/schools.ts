// GET /api/v1/schools
// Returns the full list of supported schools with id, name, district, address, lat/lng.

import { jsonResponse } from "../_lib";
import { SCHOOLS } from "../_schools";

export const config = { runtime: "edge" };

export default async function handler(_req: Request): Promise<Response> {
  return jsonResponse({
    count: SCHOOLS.length,
    schools: SCHOOLS,
    generated_at: new Date().toISOString(),
  });
}
