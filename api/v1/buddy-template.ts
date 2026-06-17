// GET /api/v1/buddy-template?name=<str>&time=<ISO>&friend_lat=<num>&friend_lng=<num>
//
// Returns: { sms_text, sms_link (sms:), email_subject, email_body, mailto_link,
//            ics_content, ics_filename, friend_zone_status }
//
// Designed for: mutual-aid networks, community organizers, school PTAs,
// or anyone who wants to programmatically generate buddy-check messages.

import { fetchAlertsAtPoint, jsonResponse, errorResponse, genasysUrl } from "../_lib";

export const config = { runtime: "edge" };

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function buildIcs(opts: {
  uid: string;
  startUtc: Date;
  endUtc: Date;
  summary: string;
  description: string;
}): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//redflag-check//buddy template//EN",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(opts.startUtc)}`,
    `DTEND:${fmt(opts.endUtc)}`,
    `SUMMARY:${escapeIcs(opts.summary)}`,
    `DESCRIPTION:${escapeIcs(opts.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "your neighbor";
  const timeIso = url.searchParams.get("time"); // optional, default tonight 22:30 local
  const friendLat = url.searchParams.get("friend_lat");
  const friendLng = url.searchParams.get("friend_lng");

  // Default reminder time: 22:30 PT today
  let startUtc: Date;
  if (timeIso) {
    const d = new Date(timeIso);
    if (Number.isNaN(d.getTime())) return errorResponse("Invalid time. Use ISO 8601.", 422);
    startUtc = d;
  } else {
    // 22:30 PT today = 05:30 UTC tomorrow (PT is UTC-7 PDT or UTC-8 PST)
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset(); // assumes server is in PT; safer to hardcode
    // Force PT (UTC-7 PDT, fire season is summer/fall)
    const ptOffsetHours = 7;
    const ptToday = new Date(now.getTime() - ptOffsetHours * 3600 * 1000);
    ptToday.setUTCHours(22, 30, 0, 0); // 22:30 in PT = 05:30 UTC + offset
    startUtc = new Date(ptToday.getTime() + ptOffsetHours * 3600 * 1000);
  }
  const endUtc = new Date(startUtc.getTime() + 15 * 60 * 1000);

  // Get friend's zone status if coords provided
  let friendZoneStatus: any = null;
  if (friendLat && friendLng) {
    const lat = parseFloat(friendLat);
    const lng = parseFloat(friendLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const alerts = await fetchAlertsAtPoint(lat, lng);
      const rf = alerts.filter((a) => a.event === "Red Flag Warning");
      friendZoneStatus = {
        in_red_flag_zone: rf.length > 0,
        active_red_flag_warnings: rf,
        genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
      };
    }
  }

  const smsText = `Hey ${name}, red flag warning tonight in your area. Checking in. Are you set with phone charged + car keys near the door? Reply 1 = OK, 2 = call me.`;
  const smsLink = `sms:&body=${encodeURIComponent(smsText)}`;

  const emailSubject = `Quick check tonight: Red Flag Warning`;
  const emailBody = `Hey ${name},\n\nThere's a Red Flag Warning in your area tonight. I wanted to check on you. A few things to verify before bed:\n\n1. Phone charged and bring it to bed with sound on?\n2. Car keys near the door, gas tank above half?\n3. Go-bag ready (meds, IDs, phone charger, water, shoes)?\n4. Pets / family ready to move if needed?\n\nNo evacuation is required right now. Just preparing in case.\n\nReply when you can. If you want me to come by, just say.\n\nTalk soon.`;
  const mailtoLink = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const ics = buildIcs({
    uid: `buddy-${Date.now()}@redflag-check.info`,
    startUtc,
    endUtc,
    summary: `Text-check ${name} (Red Flag Warning)`,
    description: `${smsText}\n\nFriend zone lookup: ${friendZoneStatus?.genasys_evacuation_zone_lookup ?? "(provide friend_lat/friend_lng for direct link)"}`,
  });
  const icsFilename = `redflag-buddy-${name.toLowerCase().replace(/\s+/g, "-")}.ics`;

  return jsonResponse({
    name,
    reminder_start_iso: startUtc.toISOString(),
    reminder_end_iso: endUtc.toISOString(),
    sms_text: smsText,
    sms_link: smsLink,
    email_subject: emailSubject,
    email_body: emailBody,
    mailto_link: mailtoLink,
    ics_content: ics,
    ics_filename: icsFilename,
    ics_data_url: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`,
    friend_zone_status: friendZoneStatus,
    generated_at: new Date().toISOString(),
  });
}
