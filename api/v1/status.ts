// GET /api/v1/status
// Current active Red Flag Warnings in California — useful for any system that
// just wants the list (e.g., a county PIO dashboard, a school-district admin
// page, a Bay Area news widget).

import { jsonResponse, USER_AGENT } from "../_lib";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const area = url.searchParams.get("area") ?? "CA";

  const res = await fetch(
    `https://api.weather.gov/alerts/active?area=${encodeURIComponent(area)}&event=Red%20Flag%20Warning`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" } }
  );

  if (!res.ok) {
    return jsonResponse({ error: "NWS upstream error", status: res.status }, 502);
  }
  const data = (await res.json()) as any;
  const features: any[] = data?.features || [];

  const warnings = features.map((f) => {
    const p = f.properties || {};
    return {
      id: f.id,
      event: p.event,
      headline: p.headline,
      starts: p.onset || p.effective,
      ends: p.ends || p.expires,
      expires: p.expires,
      severity: p.severity,
      sender_name: p.senderName,
      affected_areas: (p.areaDesc || "").split(";").map((s: string) => s.trim()),
      affected_zones: p.affectedZones || [],
      instruction: p.instruction,
    };
  });

  return jsonResponse({
    area,
    count: warnings.length,
    active_red_flag_warnings: warnings,
    source: "NWS api.weather.gov",
    disclaimer: "Informational only. For official emergency alerts, see weather.gov and ACalert.org.",
    generated_at: new Date().toISOString(),
  });
}
