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
  // downwind of east-Contra-Costa ignition risk. Added after Fire Safe
  // Moraga-Orinda ED Rob Schroeder asked for local school coverage (2026-06-16).
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
];

export function findSchool(id: string): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}
