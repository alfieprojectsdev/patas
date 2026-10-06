# Patas

Patas picks a meeting spot for a high school group project so that nobody gets stuck with the long commute. *Patas* is Tagalog for "even" or "fair".

It covers Quezon City only for now. Members can start up to 5 km outside the city line, since plenty of QC students live in Caloocan, Marikina or San Mateo.

![Fairest spots for four members, with each person's trip drawn to the top pick](docs/screenshots/2-fair-spots.png)

## How it works

Each member picks a public landmark near where they'll start: their school, an LRT/MRT station, a mall, a church or their barangay hall. Home addresses aren't an option, because the search only knows public places.

There are two ways to do this. One person can enter everyone's landmarks on a single phone, or they can create a group link, send it to the group chat, and let each member add their own landmark on their own phone. With a group link, nobody in the group sees anyone else's landmark; they only see the results.

<img src="docs/screenshots/1-pick-landmarks.png" alt="Landmark search: typing 'sm nor' suggests SM City North Edsa" width="560">

Patas then shortlists about 20 venues (libraries, malls, cafés, fast food, community centres, co-working spaces), gets each member's travel time to each one, and ranks them:

1. the shortest longest trip, so the worst-off member is as well off as possible;
2. then the smallest gap between the longest and shortest trip;
3. then the smallest total travel time.

Differences of 5 minutes or less count as ties and fall through to the next rule. The midpoint of everyone's locations is only used to start the search. It's rarely the fairest answer, because roads and traffic aren't symmetric.

On the map, each member's starting point is a ~200 m hexagon (an [H3](https://h3geo.org) cell), never an exact point. The numbered pins are the ranked venues, and the dashed lines show who travels to the selected one. They're straight lines, not routes.

<img src="docs/screenshots/3-phone-dark.png" alt="The same results on a phone in dark mode" width="320">

The screenshots were taken in estimate mode (see below), which is why they carry a "dev mode" warning. Real travel times need an OpenRouteService key.

## Privacy

The people using this are minors, so the design keeps their locations out of everything that persists or leaves the server:

- The landmark list stores H3 cells, not coordinates, and the app sends only cell ids to the server.
- A group link looks like `/g/<id>#k=<key>`. The key is made in the organiser's browser and sits after the `#`, which browsers never send to a server, so it can't end up in logs. The app passes it in request bodies instead.
- Each member's cell is stored encrypted (AES-256-GCM) with a key derived from that link key, which the server never stores. A copy of the database alone reveals no locations. The cell is decrypted only in memory while ranking, is never sent back to anyone, and is deleted 48 hours after joining.
- Nicknames stay in the browser. The API sees `m1`, `m2`, and so on.
- Landmark search, candidate venues and map tiles are all served from local OpenStreetMap snapshots, so no third party sees what a member typed or which part of the city they're looking at.
- The only outside call is the travel-time request to the routing provider, which gets cell centres, not landmarks.
- Nothing location-related is logged, and the only location data stored is those encrypted, expiring cells.

## Run it locally

You need Node 22.6 or newer.

```bash
npm install
```

The map needs a Metro Manila basemap (about 39 MB). Install the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases), then:

```bash
npm run fetch:tiles
```

Without a routing key, run in estimate mode, which fakes travel times from straight-line distance. Put this in `.env.local`:

```
ROUTING_PROVIDER=estimate
```

For real driving and walking times, use a free [OpenRouteService](https://openrouteservice.org) key instead:

```
ORS_API_KEY=your-key
```

Then:

```bash
npm run dev
```

Open http://localhost:3000.

Group links need a database. Locally they work with no setup: without `DATABASE_URL`, the dev server keeps a [PGlite](https://pglite.dev) database (Postgres compiled to WebAssembly) in `.data/`. For a real deployment, point `DATABASE_URL` at Postgres (Supabase's pooled connection string works) and apply the migrations:

```bash
npm run db:migrate
```

## Useful commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (scoring, scope, H3, landmark search, OSM parsing, group links against PGlite) |
| `npm run db:migrate` | Apply new files in `supabase/migrations` to `DATABASE_URL` |
| `npm run db:purge` | Delete expired encrypted cells and groups (the app also does this as it runs) |
| `npm run smoke` | Live check of candidate lookup and routing with three public landmarks |
| `npm run fetch:venues` | Rebuild `data/qc-venues.json` from OpenStreetMap |
| `npm run fetch:landmarks` | Rebuild `data/qc-landmarks.json` |
| `npm run fetch:boundary` | Regenerate the Quezon City boundary polygon |
| `npm run fetch:tiles` | Cut the Metro Manila basemap into `public/tiles/` |
| `npm run screenshots` | Regenerate the images in this README (see the script header) |

## Status

This is an MVP. Still to come:

- "we met here", so the next search favours whoever travelled most last time;
- jeepney, UV and train times, and fares;
- a curated list of venues that actually let students stay for hours.

The working notes and ordered next steps are in [CLAUDE.md](CLAUDE.md).

## Data

Venue, landmark, boundary and map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the ODbL. Basemap tiles are built by [Protomaps](https://protomaps.com).
