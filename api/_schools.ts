// East Bay schools with pre-resolved lat/lng for fast lookup.
// Coordinates are approximate (good to ~50 m) and were resolved from public addresses.
// To add a school, append an entry with id, name, district, address, lat, lng.

export interface School {
  id: string;
  name: string;
  district: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  // hill_proximity: rough classifier for fire risk context
  // "hills" = in or directly adjacent to East Bay Hills WUI
  // "ridge" = ridge-adjacent (Pleasanton ridge, Fremont hills)
  // "flats" = valley floor
  zone_class: "hills" | "ridge" | "flats";
}

export const SCHOOLS: School[] = [
  // Oakland Hills (CAZ515 East Bay Hills core)
  {
    id: "skyline-oakland",
    name: "Skyline High School",
    district: "Oakland Unified",
    address: "12250 Skyline Blvd",
    city: "Oakland",
    lat: 37.7811,
    lng: -122.1556,
    zone_class: "hills",
  },
  {
    id: "oakland-tech",
    name: "Oakland Technical High School",
    district: "Oakland Unified",
    address: "4351 Broadway",
    city: "Oakland",
    lat: 37.832,
    lng: -122.2625,
    zone_class: "flats",
  },
  // Berkeley
  {
    id: "berkeley-high",
    name: "Berkeley High School",
    district: "Berkeley Unified",
    address: "1980 Allston Way",
    city: "Berkeley",
    lat: 37.8693,
    lng: -122.2722,
    zone_class: "flats",
  },
  // Castro Valley
  {
    id: "castro-valley-high",
    name: "Castro Valley High School",
    district: "Castro Valley Unified",
    address: "19400 Santa Maria Ave",
    city: "Castro Valley",
    lat: 37.6975,
    lng: -122.0833,
    zone_class: "hills",
  },
  // Hayward
  {
    id: "hayward-high",
    name: "Hayward High School",
    district: "Hayward Unified",
    address: "1633 East Ave",
    city: "Hayward",
    lat: 37.6741,
    lng: -122.0666,
    zone_class: "ridge",
  },
  {
    id: "mount-eden-high",
    name: "Mt. Eden High School",
    district: "Hayward Unified",
    address: "2300 Panama St",
    city: "Hayward",
    lat: 37.625,
    lng: -122.0928,
    zone_class: "flats",
  },
  // Fremont (FUSD)
  {
    id: "mission-san-jose-high",
    name: "Mission San Jose High School",
    district: "Fremont Unified",
    address: "41717 Palm Ave",
    city: "Fremont",
    lat: 37.5275,
    lng: -121.9183,
    zone_class: "ridge",
  },
  {
    id: "irvington-high",
    name: "Irvington High School",
    district: "Fremont Unified",
    address: "41800 Blacow Rd",
    city: "Fremont",
    lat: 37.5286,
    lng: -121.9572,
    zone_class: "flats",
  },
  {
    id: "american-high",
    name: "American High School",
    district: "Fremont Unified",
    address: "36300 Fremont Blvd",
    city: "Fremont",
    lat: 37.5828,
    lng: -122.0214,
    zone_class: "flats",
  },
  {
    id: "washington-high",
    name: "Washington High School",
    district: "Fremont Unified",
    address: "38442 Fremont Blvd",
    city: "Fremont",
    lat: 37.5581,
    lng: -121.9892,
    zone_class: "flats",
  },
  {
    id: "kennedy-high",
    name: "John F. Kennedy High School",
    district: "Fremont Unified",
    address: "39999 Blacow Rd",
    city: "Fremont",
    lat: 37.5475,
    lng: -121.9586,
    zone_class: "flats",
  },
  // Pleasanton
  {
    id: "amador-valley-high",
    name: "Amador Valley High School",
    district: "Pleasanton Unified",
    address: "1155 Santa Rita Rd",
    city: "Pleasanton",
    lat: 37.6708,
    lng: -121.8678,
    zone_class: "ridge",
  },
  {
    id: "foothill-high",
    name: "Foothill High School",
    district: "Pleasanton Unified",
    address: "4375 Foothill Rd",
    city: "Pleasanton",
    lat: 37.6803,
    lng: -121.9136,
    zone_class: "ridge",
  },
  // Lamorinda (Contra Costa County, Acalanes Union HSD), canyon/WUI terrain
  // downwind of east-Contra-Costa ignition risk. Added 2026-06-16 after a local
  // fire-safety council asked for school coverage in their area.
  {
    id: "campolindo-high",
    name: "Campolindo High School",
    district: "Acalanes Union High",
    address: "300 Moraga Rd",
    city: "Moraga",
    lat: 37.8663,
    lng: -122.1271,
    zone_class: "hills",
  },
  {
    id: "miramonte-high",
    name: "Miramonte High School",
    district: "Acalanes Union High",
    address: "750 Moraga Way",
    city: "Orinda",
    lat: 37.8426,
    lng: -122.145,
    zone_class: "hills",
  },
  {
    id: "acalanes-high",
    name: "Acalanes High School",
    district: "Acalanes Union High",
    address: "1200 Pleasant Hill Rd",
    city: "Lafayette",
    lat: 37.9045,
    lng: -122.0974,
    zone_class: "hills",
  },
  // Lamorinda K-8 (Moraga SD, Orinda Union SD, + 2 private), added 2026-06-17.
  // Elementary/middle schools are the priority: younger kids can't drive themselves
  // out, so parent pickup is the evacuation bottleneck (per local fire-safety feedback).
  {
    id: "camino-pablo-elem",
    name: "Camino Pablo Elementary School",
    district: "Moraga School District",
    address: "1111 Camino Pablo",
    city: "Moraga",
    lat: 37.823,
    lng: -122.1246,
    zone_class: "hills",
  },
  {
    id: "los-perales-elem",
    name: "Los Perales Elementary School",
    district: "Moraga School District",
    address: "22 Wakefield Dr",
    city: "Moraga",
    lat: 37.8476,
    lng: -122.1382,
    zone_class: "hills",
  },
  {
    id: "rheem-elem",
    name: "Donald L. Rheem Elementary School",
    district: "Moraga School District",
    address: "90 Laird Dr",
    city: "Moraga",
    lat: 37.8576,
    lng: -122.133,
    zone_class: "hills",
  },
  {
    id: "joaquin-moraga-intermediate",
    name: "Joaquin Moraga Intermediate School",
    district: "Moraga School District",
    address: "1010 Camino Pablo",
    city: "Moraga",
    lat: 37.8274,
    lng: -122.1314,
    zone_class: "hills",
  },
  {
    id: "del-rey-elem",
    name: "Del Rey Elementary School",
    district: "Orinda Union School District",
    address: "25 El Camino Moraga",
    city: "Orinda",
    lat: 37.8464,
    lng: -122.1541,
    zone_class: "hills",
  },
  {
    id: "glorietta-elem",
    name: "Glorietta Elementary School",
    district: "Orinda Union School District",
    address: "15 Martha Rd",
    city: "Orinda",
    lat: 37.8724,
    lng: -122.1635,
    zone_class: "hills",
  },
  {
    id: "sleepy-hollow-elem",
    name: "Sleepy Hollow Elementary School",
    district: "Orinda Union School District",
    address: "20 Washington Ln",
    city: "Orinda",
    lat: 37.9078,
    lng: -122.1975,
    zone_class: "hills",
  },
  {
    id: "wagner-ranch-elem",
    name: "Wagner Ranch Elementary School",
    district: "Orinda Union School District",
    address: "350 Camino Pablo",
    city: "Orinda",
    lat: 37.8962,
    lng: -122.2069,
    zone_class: "hills",
  },
  {
    id: "orinda-intermediate",
    name: "Orinda Intermediate School",
    district: "Orinda Union School District",
    address: "80 Ivy Dr",
    city: "Orinda",
    lat: 37.8514,
    lng: -122.1455,
    zone_class: "hills",
  },
  {
    id: "saklan-school",
    name: "The Saklan School",
    district: "Independent (PK-8)",
    address: "1678 School St",
    city: "Moraga",
    lat: 37.8332,
    lng: -122.1331,
    zone_class: "hills",
  },
  {
    id: "st-perpetua-school",
    name: "St. Perpetua School",
    district: "Catholic (K-8)",
    address: "3454 Hamlin Rd",
    city: "Lafayette",
    lat: 37.8818,
    lng: -122.1134,
    zone_class: "hills",
  },
];

export function findSchool(id: string): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}
