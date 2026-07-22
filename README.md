# redflag-check

**Red Flag Warning zone check**, address-in, plain-English-out.

A free, no-signup web tool + public REST API. Built in 48 hours during the 6/10–11 2026 Alameda County Red Flag Warning by a Fremont high schooler.

- **Web UI:** https://redflag-check.info
- **Public API:** https://redflag-check.info/api/v1
- **API docs:** https://redflag-check.info/docs
- **OpenAPI 3.1 spec:** https://redflag-check.info/openapi.yaml
- **Embed widget:** `/embed/zone-check`

## Why this exists

The 6/9/2026 AC Alert text was sent county-wide. The actual NWS Red Flag Warning only covers NWS zone CAZ515 (East Bay Hills). Half the county was told to prepare a go-bag they don't need; some people in the hills don't realize the warning is right next to them and should pre-position.

This tool closes that gap. Type your address → get a clear yes/no, your evacuation zone, tonight's wind forecast, and a plain-English action checklist.

## What's in this repo

- `public/index.html`, three-tab web UI: zone check, schools, buddy
- `public/docs.html`, public API documentation
- `public/embed-zone-check.html`, iframe-able widget for any external site
- `api/v1/zone-check.ts`, primary endpoint, address or coords → verdict + checklist
- `api/v1/status.ts`, current active Red Flag Warnings in any state
- `api/v1/schools.ts`, schools by radius or name search across California, plus the curated list
- `api/v1/school-status.ts`, per-school decision view (CIF AQI + wind + RFW)
- `api/v1/buddy-template.ts`, sms / mailto / .ics for buddy-check messages
- `api/v1/health.ts`, service + upstream health probe
- `api/_lib.ts`, Census geocoder, NWS fetchers, action checklist builder
- `api/_schools.ts`, curated (human-verified, East Bay) school list plus the bulk California CDE dataset, all with pre-resolved coordinates

## Data sources

- **NWS** `api.weather.gov`, Red Flag Warnings + hourly forecast (public domain)
- **US Census** `geocoding.geo.census.gov`, address → lat/lng (public domain)
- **Genasys Protect**, official Alameda County evacuation zones (deeplinks)
- **AirNow**, air-quality reference

## Integrators

This API is designed to be integrated by:

- **County PIO / OES dashboards**, surface address-level RFW status to constituents
- **School district websites**, show parents and principals the campus-level status
- **News widgets**, embed live RFW context in coverage
- **Mutual-aid apps**, generate buddy-check messages programmatically
- **Insurance / utilities**, internal dashboards that need normalized RFW data

No API key needed. Open CORS. 60-second edge caching. See `/docs` for endpoint reference.

## License

MIT for the wrapper, UX, and aggregation logic. API responses contain public-domain data from NWS and US Census.

## Disclaimer

Informational only. NOT an official emergency service. For official alerts, sign up at [AC Alert](https://www.acgov.org/ready/connect.htm). In case of fire, call 911.

The authoritative version is the [Terms of Use & Disclaimer](https://redflag-check.info/terms) (source: [`public/terms.html`](public/terms.html)). This project is maintained by a volunteer and is not affiliated with the National Weather Service, CAL FIRE, or any government or emergency-response agency. Note: the Terms are a good-faith, plain-English draft and have not been reviewed by an attorney.

## Contact

Vedant Thakker · `vedant28t [at] gmail [dot] com`
