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

// The message copy must never assert a Red Flag Warning at the friend's address
// that we have not verified. Four states, and the ordering matters: a failed NWS
// fetch reports in_red_flag_zone: null, so `unverified` must be decided BEFORE
// the truthiness of in_red_flag_zone, or an outage silently produces the
// reassuring "you're outside the warning area" wording. Same trap the client
// guards against in renderBuddyResult().
type MessageBasis = "in_zone" | "outside_zone" | "unverified" | "no_address";

function messageBasis(fz: { in_red_flag_zone: boolean | null; data_unavailable: boolean } | null): MessageBasis {
  if (!fz) return "no_address";
  if (fz.data_unavailable) return "unverified";
  return fz.in_red_flag_zone ? "in_zone" : "outside_zone";
}

// Only the opening premise varies. Every variant keeps the prep questions and the
// "1 = OK, 2 = call me" protocol: the UI caption hardcodes that protocol, and the
// product's position is that being outside the boundary still warrants the check-in.
// ASCII only — a smart quote or em dash forces UCS-2 and halves the SMS segment.
const SMS_PREMISE: Record<MessageBasis, string> = {
  in_zone: "red flag warning tonight in your area. Checking in.",
  outside_zone:
    "I checked and your address isn't in an active red flag warning area tonight. Wind-driven fires don't stop at that boundary, so I'm still checking in.",
  unverified:
    "I couldn't verify the red flag warning status for your address tonight, so I'm checking in anyway.",
  no_address: "checking in tonight about fire weather.",
};

const EMAIL_PREMISE: Record<MessageBasis, string> = {
  in_zone: "There's a Red Flag Warning in your area tonight. I wanted to check on you.",
  outside_zone:
    "I checked your address against the active Red Flag Warning areas and it isn't inside one tonight. Wind-driven fires don't stop at those boundaries, so I still wanted to check on you.",
  unverified:
    "I couldn't verify tonight's Red Flag Warning status for your address, so I'd rather ask than assume. I wanted to check on you.",
  no_address: "I'm checking in on people tonight about fire weather. I wanted to check on you.",
};

// "No evacuation is required right now" is a claim about their address, so it can
// only ride along with a premise that confirmed something there. Pairing it with
// "I couldn't verify" would reassure on exactly the outage path the fail-safe above
// exists to protect. This endpoint never checks evacuation orders — an RFW is not
// one — so the sentence stays only where the existing in-zone copy already had it.
const EMAIL_CLOSER: Record<MessageBasis, string> = {
  in_zone: "No evacuation is required right now. Just preparing in case.",
  outside_zone: "Just preparing in case.",
  unverified: "Just preparing in case.",
  no_address: "Just preparing in case.",
};

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
      const alertsRes = await fetchAlertsAtPoint(lat, lng);
      if (alertsRes.ok) {
        const rf = alertsRes.alerts.filter((a) => a.event === "Red Flag Warning");
        friendZoneStatus = {
          in_red_flag_zone: rf.length > 0,
          data_unavailable: false,
          active_red_flag_warnings: rf,
          genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
        };
      } else {
        // Fail-safe: a failed NWS fetch is "unknown", never "not in a zone" — the
        // check-in message should still go out.
        friendZoneStatus = {
          in_red_flag_zone: null,
          data_unavailable: true,
          note: "Live NWS warning data is unreachable; this address could not be verified. Assume warning conditions and send the check-in anyway.",
          active_red_flag_warnings: [],
          genasys_evacuation_zone_lookup: genasysUrl(lat, lng),
        };
      }
    }
  }

  const basis = messageBasis(friendZoneStatus);

  const smsText = `Hey ${name}, ${SMS_PREMISE[basis]} Are you set with phone charged + car keys near the door? Reply 1 = OK, 2 = call me.`;
  const smsLink = `sms:&body=${encodeURIComponent(smsText)}`;

  const emailSubject =
    basis === "in_zone" ? `Quick check tonight: Red Flag Warning` : `Quick check tonight: fire weather`;
  const emailBody = `Hey ${name},\n\n${EMAIL_PREMISE[basis]} A few things to verify before bed:\n\n1. Phone charged and bring it to bed with sound on?\n2. Car keys near the door, gas tank above half?\n3. Go-bag ready (meds, IDs, phone charger, water, shoes)?\n4. Pets / family ready to move if needed?\n\n${EMAIL_CLOSER[basis]}\n\nReply when you can. If you want me to come by, just say.\n\nTalk soon.`;
  const mailtoLink = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const ics = buildIcs({
    uid: `buddy-${Date.now()}@redflag-check.info`,
    startUtc,
    endUtc,
    summary: `Text-check ${name} (${basis === "in_zone" ? "Red Flag Warning" : "fire weather"})`,
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
