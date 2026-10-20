# Running OSRM locally for precompute

OSRM gives free-flow driving and walking times over OpenStreetMap roads, like
openrouteservice, but with no daily quota, because it runs on your machine.
Patas uses it through `osrmProvider` (`ROUTING_PROVIDER=osrm`) to build the
precomputed tables in `data/tables/`. Nothing here involves an LLM.

Measured on 2026-10-20 on this project's laptop (Docker Desktop VM with 8
CPUs and 7.6 GiB of RAM, Philippines extract of 610,684,141 bytes):

| Step | Car | Foot |
|---|---|---|
| osrm-extract | 14 min 46 s, peak ~6.1 GiB | 11 min 5 s, peak ~5.5 GiB |
| osrm-partition | 3 min 7 s, peak ~1.5 GiB | 2 min 51 s, peak ~1.7 GiB |
| osrm-customize | 1 min 14 s, peak ~0.9 GiB | 41 s, peak ~0.8 GiB |
| Files on disk | 2.5 GB | 2.7 GB |

Extract is the only step near the VM's memory limit; with less than about
7 GiB for Docker it may be killed. A running osrm-routed uses about 1.2–1.3
GiB per profile. A 50 × 150 table request takes about 0.9 s for either
profile, so a 1,000-venue table (about 800 requests per mode) takes about
12 minutes.

## 1. Get the map data

From Geofabrik, about 580 MB:

```powershell
mkdir $HOME\osrm; cd $HOME\osrm
curl.exe -LO https://download.geofabrik.de/asia/philippines-latest.osm.pbf
```

## 2. Preprocess, once per profile

Car and foot need separate folders, because each set of files belongs to one
profile. With Docker Desktop:

```powershell
mkdir car, foot
copy philippines-latest.osm.pbf car\; copy philippines-latest.osm.pbf foot\
foreach ($p in "car", "foot") {
  docker run --rm -t -v "${PWD}\${p}:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/$p.lua /data/philippines-latest.osm.pbf
  docker run --rm -t -v "${PWD}\${p}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/philippines-latest.osrm
  docker run --rm -t -v "${PWD}\${p}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/philippines-latest.osrm
}
```

## 3. Run the servers

One per profile, on two ports. `--max-table-size` must be at least
`CHUNK_ORIGINS + CHUNK_DEST` (the default is 100). The coordinates travel in
the request URL, about 21 characters each, so keep a request to a few hundred
points (50 + 150 is about 4 KB); very long URLs may be refused.

```powershell
docker run -d --name osrm-car  -p 5000:5000 -v "${PWD}\car:/data"  ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld --max-table-size 1000 /data/philippines-latest.osrm
docker run -d --name osrm-foot -p 5001:5000 -v "${PWD}\foot:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld --max-table-size 1000 /data/philippines-latest.osrm
```

Check one: `curl.exe "http://localhost:5000/table/v1/driving/121.0525,14.6195;121.028,14.5491"`
should answer `{"code":"Ok", ...}`.

## 4. Build a table

Set these in the shell, not in `.env.local`, so `npm run dev` keeps using
openrouteservice. Node's `--env-file` doesn't override variables already set.

```powershell
$env:ROUTING_PROVIDER="osrm"; $env:OSRM_DRIVE_URL="http://localhost:5000"; $env:OSRM_WALK_URL="http://localhost:5001"
$env:CHUNK_ORIGINS=50; $env:CHUNK_DEST=150
node --env-file=.env.local --experimental-strip-types scripts/precompute.ts --band weekday_dismissal --mode DRIVE --venues data/venues.json --out data/tables/drive_weekday_dismissal.json --dry-run
```

Drop `--dry-run` to build. If it stops (a crash, a closed laptop), run the
same command again: it carries on from `<out>.partial.json`.

OSRM times are free-flow, so the same table serves every time band. Copy or
link it to each `<mode>_<band>.json` name `meet` looks for.

## Licence

Tables built with OSRM carry OpenStreetMap's licence (ODbL) and need only its
credit. Tables built with openrouteservice are CC-BY-SA 4.0 and keep the
"© openrouteservice by HeiGIT" line.
