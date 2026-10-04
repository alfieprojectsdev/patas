# Patas — fair meeting spots for group projects

High school groups pick where to meet so no one carries an unfair commute.
Working name "patas" (Tagalog: even/fair). Portfolio-grade MVP first; product later.

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
- `src/lib/routing.ts` — `MatrixProvider` seam; Google Routes computeRouteMatrix default.
- `src/lib/candidates.ts` — Places API (New) searchNearby + host options.
- `src/lib/fares.ts` — stub; LTFRB fare matrices go here.
- `src/app/api/meet/route.ts` — POST endpoint, zod-validated.
- `supabase/migrations/0001_init.sql` — groups, members, meetings, burdens (no location).

## Commands
- `npm test` — node:test via --experimental-strip-types (Node ≥22.6)
- `npm run dev` — needs GOOGLE_MAPS_API_KEY in `.env.local`

## Known gaps / next steps (in order)
1. Verify Routes API element limits per mode; chunk matrix requests if needed.
2. Confirm Places `includedTypes` values; consider a curated venue allowlist
   (school, public libraries) — Google types miss "allows students to stay 4 hrs".
3. MVP UI per `src/app/page.tsx` TODOs. Join code, no accounts.
4. RLS policies + scheduled purge of expired groups.
5. Fares: LTFRB matrices, student discount, rail station-pair tables.
6. PH transit is the weak link: Google under-models jeepney/UV/tricycle.
   Intended upgrade is a Sakay.ph-backed `MatrixProvider` — approach their team
   once the MVP works end-to-end. Until then, label TRANSIT results as estimates.

## Conventions
- TypeScript strict. Keep scoring pure and provider-agnostic.
- `TODO(claude-code)` marks deliberate open items.
