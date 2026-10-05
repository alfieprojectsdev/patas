# Patas — fair meeting spots for group projects

High school groups pick where to meet so no one carries an unfair commute.
Working name "patas" (Tagalog: even/fair). Portfolio-grade MVP first; product later.

## Scope: Quezon City only (MVP)
- `src/lib/scope.ts`: venues must be inside the OSM QC boundary (relation
  106569, `src/lib/qc-boundary.ts`, regenerate with `npm run fetch:boundary`);
  origins allowed within 5 km of it (QC-school students often live in
  Caloocan/San Mateo/Marikina). Bbox is only a pre-filter.
- Out-of-area error is generic (doesn't say which member).
- Why QC-only helps:
  - Fares: tricycle fares are LGU-set, so ONE QC fare ordinance covers it.
  - QC runs its own city bus service (verify current routes and fare policy);
    a fare-free option changes the peso side of fairness.
  - Self-hosted OSRM/Valhalla can use a small Metro Manila clip (keep a
    buffer — routes leave QC, e.g. via Commonwealth/Marcos Hwy/EDSA).
  - Curated venue allowlist is tractable at city scale (QC public libraries,
    schools, malls that tolerate student groups).

## H3 snapping + precomputed tables
- `src/lib/h3.ts`: res 9 (~200 m edge). Client should snap and send only the
  cell id; API also accepts a landmark but snaps it immediately. All routing
  (live or precomputed) uses cell centres, never exact coordinates.
- `src/lib/precomputed.ts` + `scripts/precompute.ts`: offline cell→venue
  tables per (mode, time band). API uses a table if `PRECOMPUTED_DIR` has
  `<mode>_<band>.json`, else falls back to live routing. Response `source`
  says which.
- Budget first: `--dry-run` prints elements/requests. The QC polygon gives
  1,506 cells. Check provider quotas before a full run.
- Tables cover QC cells only; if any origin cell is missing (buffer-zone
  member) the API routes live instead.
- One traffic-aware Google build per band fixes ORS's no-traffic bias.
- Open: host options in table mode need a cell→cell table; `data/venues.json`
  (curated QC venues for precompute) doesn't exist yet. Don't feed it all of
  `data/qc-venues.json` (3.2k venues × 1.5k cells is ~5M elements).

## Core idea (don't regress this)
- NOT a centroid problem. The centroid is only a search seed for candidate venues.
- Discrete facility location: candidates (public venues + each member's landmark
  as a host option) → n×m travel-time matrix → rank lexicographically:
  1. minimax (worst-off member), 2. spread (max−min), 3. total.
  Near-ties within `tolerance` minutes fall through to the next objective.
- Rotation: minimax over (prior cumulative burden + this meeting). Fairness is
  judged across meetings, not per meeting.
- Time and pesos are separate objectives. Never blend them with an invented rate.

## Privacy rules (Data Privacy Act RA 10173 — users are minors)
- Inputs are user-picked LANDMARKS, not home addresses.
- Coordinates exist only in request scope. No lat/lng/address/landmark column in
  any table — reject schema changes that add one.
- Don't log request bodies or upstream error bodies (may contain coords).
- API responses never include other members' landmarks; host options return
  `location: null`.
- Persist only aliases, venue names, and per-member minutes/pesos. Groups expire.

## Layout
- `src/lib/scoring.ts` — pure ranking + centroid/haversine. Tested.
- `src/lib/routing.ts` — `MatrixProvider` seam. Default `orsProvider`
  (OpenRouteService, OSM data; DRIVE/WALK; TWO_WHEELER approximated as car;
  no TRANSIT, no traffic). `googleProvider` fallback. `ROUTING_PROVIDER` env.
- `src/lib/candidates.ts` — candidates from `data/qc-venues.json` (OSM
  snapshot, default; no network call) or live Overpass / Google Places.
  `CANDIDATE_SOURCE` env. Shortlist = one venue per H3 cell (best category),
  then smallest straight-line worst-case distance, picks ≥400 m apart.
- `src/lib/landmarks.ts` + `POST /api/landmarks` — landmark search over
  `data/qc-landmarks.json` (stations, malls, schools, churches, barangay
  halls, neighbourhoods). Snapshot stores H3 cells, not coordinates. POST so
  the query never lands in access logs.
- `scripts/fetch-{venues,landmarks,boundary}.ts` — rebuild the OSM snapshots
  (`npm run fetch:venues` etc.). Overpass mirror fallback in `scripts/overpass.ts`.
- `src/app/planner.tsx` — single-device planner UI. Nicknames stay in the
  browser; the API sees m1..mN.
- `src/app/map.tsx` — Leaflet + protomaps-leaflet. Basemap is a self-hosted
  Metro Manila PMTiles extract in `public/tiles/` (gitignored, ~39 MB,
  `npm run fetch:tiles`, needs the go-pmtiles CLI). No third-party tile
  server, so nobody outside sees which area a member is viewing. Members are
  drawn as their H3 cell; the landmarks API returns the cell outline.
  protomaps-leaflet reads Leaflet from `window.L`; load the map with
  next/dynamic, ssr:false.
- `src/lib/fares.ts` — stub; LTFRB fare matrices go here.
- `src/app/api/meet/route.ts` — POST endpoint, zod-validated.
- `supabase/migrations/0001_init.sql` — groups, members, meetings, burdens (no location).

## Commands
- `npm test` — node:test via --experimental-strip-types (Node ≥22.6)
- `npm run dev` — needs ORS_API_KEY in `.env.local` (or
  `ROUTING_PROVIDER=estimate` for fake straight-line times, dev only)
- `npm run smoke` — live check of candidates + routing with public landmarks
- `npm run screenshots` — README images via playwright-core + installed Edge,
  against a production build (`next start`), not the dev server
- Don't run `next build` while `next dev` is running: they share `.next`
  and the dev page stops hydrating (chunk 404s).

## Provider strategy
- MVP: ORS hosted free tier + OSM snapshots. Zero infra, zero cost.
- ORS (HeiGIT account): base URL `https://api.heigit.org/openrouteservice`
  (`ORS_BASE_URL` overrides). 3,500 matrix elements per request. Terms forbid
  sending personal data, which is one more reason only H3 cell centres go out.
  Results are CC-BY-SA 4.0; show "© openrouteservice by HeiGIT | Data from
  OpenStreetMap" wherever ORS times appear (planner does this).
- Public Overpass is offline-only: on 2026-10-05 three mirrors returned 504s
  or took 90-200 s within the same hour. Never call it on the request path.
- Privacy upgrade: self-host OSRM (`table` service) or Valhalla on a small VPS
  (PH extract) so minors' coordinates never leave our server. Add as a new
  `MatrixProvider`; Vercel can't host it.
- Don't trust OSM `opening_hours` in PH (sparse). Venue POIs are spottier than
  Google's; roads in Metro Manila are fine.
- Public Nominatim forbids autocomplete — landmark search needs Photon,
  self-hosted Nominatim, or Google Places Autocomplete.

## Known gaps / next steps (in order)
1. Smoke-test ORS with a real key (`npm run smoke`). Overpass is done (see
   Provider strategy). Verify ORS free-tier matrix limits and Routes API
   limits; chunk if needed.
2. Curated venue allowlist (school, public libraries) — neither OSM nor Google
   knows "lets students stay 4 hrs". OSM snapshot already drops
   access=private and staff canteens.
3. Join-code flow (`src/app/page.tsx` TODOs). Open question: where members'
   cells wait until everyone has joined, given "coordinates only in request
   scope". Single-device planner works today.
4. RLS policies + scheduled purge of expired groups.
5. Fares: LTFRB matrices, student discount, rail station-pair tables.
6. PH transit is the weak link: Google under-models jeepney/UV/tricycle.
   Intended upgrade is a Sakay.ph-backed `MatrixProvider` — approach their team
   once the MVP works end-to-end. Until then, label TRANSIT results as estimates.

## Conventions
- TypeScript strict. Keep scoring pure and provider-agnostic.
- `TODO(claude-code)` marks deliberate open items.
