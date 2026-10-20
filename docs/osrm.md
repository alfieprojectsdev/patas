# Running OSRM locally for precompute

OSRM gives free-flow driving and walking times over OpenStreetMap roads, like
openrouteservice, but with no daily quota, because it runs on your machine.
Patas uses it through `osrmProvider` (`ROUTING_PROVIDER=osrm`) to build the
precomputed tables in `data/tables/`. Nothing here involves an LLM.

Not measured yet: how much RAM the Philippines needs during preprocessing, and
how long a full table build takes. Check both on the first run and write the
numbers here.

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
`CHUNK_ORIGINS + CHUNK_DEST` (the default is 100).

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
$env:CHUNK_ORIGINS=100; $env:CHUNK_DEST=400
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
