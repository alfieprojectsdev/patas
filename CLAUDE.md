# Patas — fair meeting spots for group projects

High school groups pick where to meet so no one carries an unfair commute.
Working name "patas" (Tagalog: even/fair). Portfolio-grade MVP first; product later.

## Scope: Quezon City only (MVP)
- `src/lib/scope.ts`: venues must be in QC; origins allowed within a 5 km
  buffer (QC-school students often live in Caloocan/San Mateo/Marikina).
- Current check is a rough bbox — replace with the OSM QC boundary polygon.
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
- Budget first: `--dry-run` prints elements/requests. Bbox gives ~3.6k cells;
  the QC polygon cuts that to ~1.5k. Check provider quotas before a full run.
- One traffic-aware Google build per band fixes ORS's no-traffic bias.
- Open: host options in table mode need a cell→cell table; `data/venues.json`
  (curated QC venues) doesn't exist yet — see `data/venues.example.json`.

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
- `src/lib/candidates.ts` — Overpass (OSM, default) or Google Places (New),
  plus host options. `CANDIDATE_SOURCE` env. Parsers are pure + tested.
- `src/lib/fares.ts` — stub; LTFRB fare matrices go here.
- `src/app/api/meet/route.ts` — POST endpoint, zod-validated.
- `supabase/migrations/0001_init.sql` — groups, members, meetings, burdens (no location).

## Commands
- `npm test` — node:test via --experimental-strip-types (Node ≥22.6)
- `npm run dev` — needs GOOGLE_MAPS_API_KEY in `.env.local`

## Provider strategy
- MVP: ORS hosted free tier + public Overpass. Zero infra, zero cost.
- Privacy upgrade: self-host OSRM (`table` service) or Valhalla on a small VPS
  (PH extract) so minors' coordinates never leave our server. Add as a new
  `MatrixProvider`; Vercel can't host it.
- Don't trust OSM `opening_hours` in PH (sparse). Venue POIs are spottier than
  Google's; roads in Metro Manila are fine.
- Public Nominatim forbids autocomplete — landmark search needs Photon,
  self-hosted Nominatim, or Google Places Autocomplete.

## Known gaps / next steps (in order)
1. Smoke-test ORS + Overpass live with real keys (unit tests use fixtures only).
   Verify ORS free-tier matrix limits and Routes API limits; chunk if needed.
2. Curated venue allowlist (school, public libraries) — neither OSM nor Google
   knows "lets students stay 4 hrs".
3. MVP UI per `src/app/page.tsx` TODOs. Join code, no accounts.
4. RLS policies + scheduled purge of expired groups.
5. Fares: LTFRB matrices, student discount, rail station-pair tables.
6. PH transit is the weak link: Google under-models jeepney/UV/tricycle.
   Intended upgrade is a Sakay.ph-backed `MatrixProvider` — approach their team
   once the MVP works end-to-end. Until then, label TRANSIT results as estimates.

## Conventions
- TypeScript strict. Keep scoring pure and provider-agnostic.
- `TODO(claude-code)` marks deliberate open items.
