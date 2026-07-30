// Spanish (es) string layer — v1, AI-drafted, PENDING HUMAN REVIEW.
//
// ── THREE RULES THAT MAKE THIS SAFE. Do not remove. ────────────────────────
//
// 1. ALONGSIDE, NEVER INSTEAD. Spanish renders directly beneath the English,
//    never in place of it. A translation error can therefore never be the only
//    thing a user sees.
//
// 2. ALL-OR-NOTHING PER STRING. es() returns null unless the WHOLE string is
//    covered. Partial Spanish is worse than none: the specific failure this
//    guards against is a verdict headline translating while its urgent action
//    sentence does not, which leaves a Spanish reader with the calm half and
//    the English-only alarming half. That is false reassurance produced by
//    coverage shape rather than by a bad translation, and the AI-generated
//    notice does not excuse it.
//
// 3. NEVER ADD OBLIGATIONS. This layer only re-expresses strings the
//    deterministic engine already authored. It must not introduce a safety
//    instruction the English does not give. If new guidance is wanted, add it
//    to the English checklist in api/_lib.ts and translate it from there.
//
// This file never participates in deciding a verdict. It is display only.
//
// ── Review status ─────────────────────────────────────────────────────────
// v1 drafted 2026-07-29. Corrected 2026-07-29 after a 7-agent adversarial
// review (6 blind lenses + adjudicator). Fixes applied from that review:
//   · "power tools" was rendered "herramientas eléctricas" = ELECTRIC only,
//     silently exempting the gas equipment (weed whackers, chainsaws) that is
//     the actual Red Flag ignition risk. A prohibition that granted permission.
//   · "upwind of you" was ambiguous and invertible toward "the wind is carrying
//     it away from me" — on the downwind headline, whose whole point is the
//     opposite.
//   · "Alerta de Bandera Roja" → "Advertencia de Bandera Roja", the term NWS and
//     California agencies actually publish. A resident scanning weather.gov for
//     "Alerta" would not find it and could conclude no warning is in effect.
//   · An adjacent string asserted "y no dentro de ella" (a safe-status claim the
//     English never makes).
//   · Added the escalation, data-unavailable and degraded strings that were
//     rendered in English while the calmer verdict text was translated.
// HUMAN REVIEWER: __________________ (pending — Vedant, AP Spanish L3)
// Until a reviewer signs that line, the UI must keep showing the AI notice.

export const ES = {
  // ---- Disclaimer / chrome -------------------------------------------------
  "__notice_title": "Traducción generada por inteligencia artificial",
  "__notice_body":
    "Esta traducción al español fue generada por inteligencia artificial y aún no ha sido revisada por una persona. " +
    "Puede contener errores. El texto en inglés es la versión correcta: si el español y el inglés no coinciden, haga caso al inglés. " +
    "Algunas partes de esta página aparecen solo en inglés. Léalas también, porque pueden ser las más importantes. " +
    "En una emergencia, llame al 911 y siga las órdenes oficiales de evacuación.",
  "__toggle_on": "Ver en español",
  "__toggle_off": "English only",
  "__english_above": "Inglés arriba",

  // ---- Verdict headlines ---------------------------------------------------
  "Your address is inside the active Red Flag Warning.":
    "Su dirección está dentro de la Advertencia de Bandera Roja activa.",
  "Elevated fire and smoke threat headed your way over the next day or two.":
    "Amenaza elevada de incendio y humo que se dirige hacia usted en el próximo día o dos.",
  "High fire threat: wind is pushing fire conditions toward your address tonight.":
    "Alta amenaza de incendio: esta noche el viento está trayendo el peligro de incendio hacia su casa.",
  "Smoke and air quality risk from a warning area upwind of you.":
    "Riesgo de humo y mala calidad del aire: el viento sopla desde una zona de alerta hacia usted.",
  "You're near the active warning. Stay alert.":
    "Usted está cerca de la alerta activa. Manténgase alerta.",
  "You're in a safer area tonight.":
    "Esta noche usted está en una zona más segura.",
  "Live warning data is unreachable right now.":
    "En este momento no se pueden obtener los datos de alerta en vivo.",
  "Red Flag Warning issued for your area":
    "Se ha emitido una Advertencia de Bandera Roja para su zona",

  // ---- Explanations under the headline (were English-only) -----------------
  "Take action tonight: prepare a go-bag and be ready to leave if instructed.":
    "Actúe esta noche: prepare una mochila de emergencia y esté listo para salir si se lo indican.",
  "Assume warning conditions persist. This tool could not confirm your address is clear — check weather.gov or your county's emergency alerts before treating tonight as safe.":
    "Suponga que las condiciones de alerta continúan. Esta herramienta no pudo confirmar que su dirección esté fuera de peligro. Consulte weather.gov o las alertas de emergencia de su condado antes de tratar esta noche como segura.",

  // ---- Downwind tier guidance (the urgent half of the explanation) ---------
  "Be ready to evacuate or follow local emergency instructions immediately.":
    "Prepárese para evacuar. Siga de inmediato las instrucciones de emergencia locales.",
  "Expect elevated fire and smoke conditions over the next day or two. Prepare a go-bag and monitor official updates.":
    "Espere condiciones elevadas de incendio y humo durante el próximo día o dos. Prepare una mochila de emergencia y siga las actualizaciones oficiales.",
  "Smoke and air quality impacts are the main concern right now. Direct fire threat is lower in the short term, but conditions can change quickly.":
    "Por ahora, la principal preocupación es el humo y la mala calidad del aire. La amenaza directa de incendio es menor a corto plazo, pero las condiciones pueden cambiar rápidamente.",

  // ---- Section labels (must match what index.html actually renders) --------
  "Bottom line": "Lo más importante",
  "What NOT to do": "Qué NO hacer",
  "What else to do": "Qué más hacer",

  // ---- in_zone · do_now ----------------------------------------------------
  "Charge your phone. Keep car keys near the door.":
    "Cargue su teléfono. Mantenga las llaves del carro cerca de la puerta.",
  "Park your car facing OUTWARD on the driveway.":
    "Estacione su carro en la entrada de su casa CON EL FRENTE HACIA LA CALLE, listo para salir sin tener que dar reversa.",
  "Fill the gas tank above half.":
    "Llene el tanque de gasolina a más de la mitad.",
  "Pack a go-bag: meds, IDs, phone charger, water, sturdy shoes.":
    "Prepare una mochila de emergencia: medicinas, identificaciones, cargador de teléfono, agua y zapatos resistentes.",
  "Locate your evacuation zone number (link below) and write it down.":
    "Busque el número de su zona de evacuación (enlace abajo) y anótelo.",
  "Make a plan for pets and family members who need assistance.":
    "Haga un plan para las mascotas y los familiares que necesiten ayuda.",
  "Set a buddy to text-check you at 11 PM tonight and 6 AM tomorrow.":
    "Pídale a un amigo o familiar que le mande un mensaje de texto hoy a las 11 de la noche y mañana a las 6 de la mañana, para ver si está bien.",

  // ---- in_zone · do_not ----------------------------------------------------
  "Do NOT mow dry grass.":
    "NO corte pasto seco.",
  "Do NOT use BBQs, fire pits, or open flames outdoors.":
    "NO use parrillas, fogatas ni llamas abiertas al aire libre.",
  "Do NOT park on dry grass.":
    "NO estacione sobre pasto seco.",
  "Do NOT drag chains (boat trailers, etc.). Sparks.":
    "NO arrastre cadenas (remolques de botes, etc.). Producen chispas.",
  "Do NOT operate power tools that throw sparks.":
    "NO use herramientas ni equipo motorizado que produzca chispas, ya sea de gasolina o eléctrico: desbrozadoras, motosierras, podadoras y esmeriles.",

  // ---- in_zone · if_evacuation_called --------------------------------------
  "Leave immediately. Do not wait for a second notice.":
    "Salga inmediatamente. No espere un segundo aviso.",
  "Take the go-bag, pets, phone, charger, IDs.":
    "Lleve la mochila de emergencia, las mascotas, el teléfono, el cargador y las identificaciones.",
  "Check Genasys Protect for your zone's status before driving.":
    "Consulte Genasys Protect para ver el estado de su zona antes de manejar.",
  "Use main roads. Avoid the canyons.":
    "Use las calles principales. Evite los cañones.",

  // ---- adjacent ------------------------------------------------------------
  "Your address is adjacent to the active RFW Affected Area.":
    "Su dirección está justo al lado de la Zona Afectada por la Advertencia de Bandera Roja activa.",
  "Wind-driven fires do not stop at the RFW Affected Area boundary. The 1991 Oakland Hills fire, the 2023 Lahaina fire, and the 2025 Palisades fire all pushed past nominal boundaries in wind events. Treat tonight as a fire-weather night.":
    "Los incendios impulsados por el viento no se detienen en el límite de la Zona Afectada. Los incendios de Oakland Hills en 1991, de Lahaina en 2023 y de Palisades en 2025 cruzaron los límites establecidos durante eventos de viento. Trate esta noche como una noche de peligro de incendio.",
  "Keep your phone charged and bring it to bed with sound on.":
    "Mantenga su teléfono cargado y llévelo a la cama con el sonido encendido.",
  "Sign up for your county's emergency alerts if you haven't (link below).":
    "Regístrese para recibir las alertas de emergencia de su condado si aún no lo ha hecho (enlace abajo).",
  "Know your Genasys zone in case conditions change.":
    "Conozca su zona de Genasys por si las condiciones cambian.",
  "Do NOT do anything that throws sparks outdoors tonight.":
    "NO haga nada que produzca chispas al aire libre esta noche.",
  "Avoid driving through fire-prone hill and canyon routes if not essential.":
    "Evite manejar por rutas de cerros y cañones propensos a incendios si no es necesario.",
  "Wind-driven fires move fast. Be ready to leave even if you're adjacent.":
    "Los incendios impulsados por el viento avanzan rápido. Esté listo para salir aunque usted esté al lado de la zona.",

  // ---- out_of_zone ---------------------------------------------------------
  "Your address is outside the active RFW Affected Area.":
    "Su dirección está fuera de la Zona Afectada por la Advertencia de Bandera Roja activa.",
  "Important: this does NOT mean fire-safe. NWS RFW Affected Areas are advisory, not boundaries that stop fire. The 1991 Oakland Hills fire, Lahaina, and the Palisades fire all pushed past nominal boundaries in wind events until they ran out of fuel or hit the ocean. During fire season, keep a go-bag ready regardless of where the Affected Area boundary falls.":
    "Importante: esto NO significa que esté a salvo del fuego. Las Zonas Afectadas del Servicio Nacional de Meteorología son solo orientativas, no son límites que detengan el fuego. Los incendios de Oakland Hills en 1991, de Lahaina y de Palisades cruzaron los límites establecidos durante eventos de viento hasta que se quedaron sin combustible o llegaron al mar. Durante la temporada de incendios, mantenga lista una mochila de emergencia sin importar dónde caiga el límite de la Zona Afectada.",
  "Tonight is still a fire-weather night in your area. Avoid sparking activities outdoors.":
    "Esta noche sigue siendo una noche de peligro de incendio en su zona. Evite actividades que produzcan chispas al aire libre.",
  "Text a neighbor in the hills. They are in the active RFW Affected Area and pre-positioning matters most in the next few hours.":
    "Mande un mensaje de texto a un vecino de los cerros. Esa persona está dentro de la Zona Afectada activa, y prepararse con anticipación importa más que nunca en las próximas horas.",
  "Sign up for your county's emergency alerts in case conditions expand (link below).":
    "Regístrese para recibir las alertas de emergencia de su condado por si las condiciones se extienden (enlace abajo).",
  "Do not assume being outside the RFW Affected Area means safe. A wind-driven fire can reach you even from an active Affected Area next door.":
    "No suponga que estar fuera de la Zona Afectada significa estar a salvo. Un incendio impulsado por el viento puede alcanzarlo incluso desde una Zona Afectada activa que esté al lado.",
  "If your area becomes affected, check Genasys Protect for your zone (link below).":
    "Si su zona llega a verse afectada, consulte Genasys Protect para ver su zona (enlace abajo).",

  // ---- data_unavailable (fail-safe state) ----------------------------------
  "Live warning data is unreachable. Treat tonight as a possible fire-weather night until you can confirm otherwise.":
    "No se pueden obtener los datos de alerta en vivo. Trate esta noche como una posible noche de peligro de incendio hasta que pueda confirmar lo contrario.",
  "Check weather.gov or local news for Red Flag Warnings in your area.":
    "Consulte weather.gov o las noticias locales para ver si hay Advertencias de Bandera Roja en su zona.",
  "Know where your go-bag essentials are: meds, IDs, phone charger, water, sturdy shoes.":
    "Sepa dónde están las cosas esenciales de su mochila de emergencia: medicinas, identificaciones, cargador de teléfono, agua y zapatos resistentes.",
  "Do NOT assume you are clear because this tool could not retrieve warning data.":
    "NO suponga que está fuera de peligro porque esta herramienta no pudo obtener los datos de alerta.",
  "Avoid sparking activities outdoors until conditions are confirmed.":
    "Evite actividades que produzcan chispas al aire libre hasta que se confirmen las condiciones.",

  // ---- Callouts ------------------------------------------------------------
  "⚠ Wind is blowing FROM the RFW Affected Area TOWARD your address. Treat tonight as if you were inside the RFW Affected Area.":
    "⚠ El viento sopla DESDE la Zona Afectada HACIA su dirección. Trate esta noche como si usted estuviera dentro de la Zona Afectada.",
};

// Exact-match lookup. Returns null on a miss, and the caller MUST treat null as
// "render English only" (rule 2). Missing coverage is a normal state for a v1
// layer and is never a reason to hide or partially render the English.
export function es(englishString) {
  if (!englishString || typeof englishString !== "string") return null;
  return ES[englishString.trim()] || null;
}

// The downwind explanation is assembled at runtime from live numbers:
//   "Active warning is {N} mi {DIR} of you. Tonight's wind is from the {DIR2} at {S} mph. {GUIDANCE}"
// The trailing guidance sentence is the urgent half, and it is exactly the part
// that would otherwise stay English while the calm headline above it turned
// Spanish. Translate the whole sentence or return null — never half of it.
// Compass abbreviations are deliberately left untranslated so they still match
// the compass graphic drawn on screen.
const DOWNWIND_RE =
  /^Active warning is (\d+(?:\.\d+)?) mi ([NSEW]{1,3}) of you\. Tonight's wind is from the ([NSEW]{1,3}) at (\d+(?:\.\d+)?) mph\. (.+)$/;

export function esExplanation(text) {
  if (!text || typeof text !== "string") return null;
  const direct = es(text);
  if (direct) return direct;

  const m = DOWNWIND_RE.exec(text.trim());
  if (!m) return null;
  const [, dist, bearing, windFrom, mph, guidance] = m;
  const guidanceEs = es(guidance);
  if (!guidanceEs) return null; // rule 2: unknown urgent half means no Spanish at all
  return `La alerta activa está a ${dist} millas al ${bearing} de usted. Esta noche el viento viene del ${windFrom} a ${mph} millas por hora. ${guidanceEs}`;
}
