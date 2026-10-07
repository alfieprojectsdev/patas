# Deploying Patas to patas.ithinkandicode.space

Goal: a working public test build today, for a handful of real users (students). Everything here fits free tiers.

## Setup

| Piece | Choice | Why |
|---|---|---|
| App | Vercel (Hobby), functions in `sin1` (Singapore) | Native Next.js hosting; Singapore is the closest region to Manila |
| Database | Neon Postgres, `aws-ap-southeast-1` (Singapore) | Washboard already runs on Neon, and `src/lib/db.ts` uses the same `pg` setup |
| Map tiles | The 39 MB PMTiles file, downloaded during the Vercel build by the `vercel-build` script | No extra service and nothing big to upload; verified serving range requests (206) |
| Travel times | OpenRouteService via your HeiGIT key | Already working locally |
| DNS | Porkbun (`ithinkandicode.space` already uses Porkbun nameservers) | One CNAME record |

Everything is provisioned from the command line (`neonctl`, `vercel`) so there's almost nothing to click. Since PR #6, Vercel builds from GitHub: every push to `main` deploys, and the `vercel-build` script downloads the map file during the build. That's what made deploying work at all from a flaky office connection, where `vercel deploy` uploads kept failing. `vercel redeploy <url> --target production` rebuilds without uploading anything, which is handy after changing an environment variable.

The only manual steps are the two browser sign-ins and the one Porkbun DNS record (Porkbun's API needs separate API keys, so the web panel is faster for a single record).

## Before deploying (done in the `deploy-prep` branch)

- PRs #3 (ranking tiers) and #4 (rush-hour range) merged into `main`.
- `vercel.json` pins functions to `sin1` (Singapore). The two search routes allow 30 s, since the routing call can take up to 20 s.
- `.vercelignore` keeps `vercel deploy` uploads small and secret-free: it never sends `.env*`, `.data/`, `.next/`, `node_modules/` or `public/tiles/`. The map file is downloaded during the build by `vercel-build` (PR #6), so a build fails loudly if GitHub or Protomaps is unreachable at that moment.
- `NEXT_PUBLIC_TILES_URL` can point the map at object storage (R2, Spaces) if Vercel won't serve the file with range requests. Unset = `/tiles/metro-manila.pmtiles`.
- The database connection timeout is 15 s, because a suspended Neon database takes a few seconds to wake.
- `/privacy`, linked from every footer, says what's stored, for how long, and who else sees what. The testers are minors, and the Data Privacy Act (RA 10173) expects that notice. It shows a contact email from `NEXT_PUBLIC_CONTACT_EMAIL`.
- Supabase references removed from the docs; `supabase/migrations/` is only a folder name.

## Sign in (you, about 5 minutes)

Two browser sign-ins; after that every step runs from the terminal. Credentials stay with you.

```bash
vercel login
```

```bash
npx neonctl@latest auth
```

## Provision and deploy (CLI, about 20 minutes)

1. Create the database in Singapore:
   ```bash
   npx neonctl@latest projects create --name patas --region-id aws-ap-southeast-1
   ```
2. Apply the schema once with the direct (unpooled) connection string:
   ```bash
   U="$(npx neonctl@latest connection-string --project-id <id>)" && [ -n "$U" ] && DATABASE_URL="$U" npm run db:migrate
   ```
   Expected output: a `database:` line naming the Neon host, then `applied: 0001_init.sql, 0002_group_links.sql`. If it says `local PGlite`, the connection string wasn't fetched; run it again. (`db.ts` refuses an empty `DATABASE_URL` rather than quietly using the local database.)
3. Create the Vercel project and set production variables. Values are piped in, so they never appear on screen:
   ```bash
   vercel link --yes --project patas
   npx neonctl@latest connection-string --project-id <id> --pooled | vercel env add DATABASE_URL production --sensitive
   grep '^ORS_API_KEY=' .env.local | cut -d= -f2- | vercel env add ORS_API_KEY production --sensitive
   ```
   Add the privacy contact (it's public, shown on `/privacy`):
   ```bash
   vercel env add NEXT_PUBLIC_CONTACT_EMAIL production --value '<email for questions>' --no-sensitive
   ```
   Don't set `PATAS_LOCAL_DB` or `ROUTING_PROVIDER` in production.
4. Deploy:
   ```bash
   vercel deploy --prod
   ```
5. Attach the domain:
   ```bash
   vercel domains add patas.ithinkandicode.space patas
   ```
   It prints the DNS record to create. At Porkbun (DNS for `ithinkandicode.space`), add it: normally a CNAME from `patas` to the target Vercel gives. Vercel issues the HTTPS certificate once DNS resolves, usually within minutes. `vercel domains inspect patas.ithinkandicode.space` shows when it's verified.

## Check before sharing the link

- [ ] `https://patas.ithinkandicode.space` loads, and landmark search answers.
- [ ] The map draws. `curl -I -H "Range: bytes=0-127" https://patas.ithinkandicode.space/tiles/metro-manila.pmtiles` returns `206`. If it doesn't, move the file to Cloudflare R2 or DigitalOcean Spaces and set `NEXT_PUBLIC_TILES_URL`.
- [ ] A single-phone search returns results with the "openrouteservice by HeiGIT" credit and rush-hour ranges.
- [ ] Group link end to end on two real phones: create, share, both join, find spots. Check that a link with the `#k=...` part cut off shows the "missing its key" message.
- [ ] Vercel function logs show paths and status codes only: no keys, no request bodies.
- [ ] The privacy page is reachable from the footer.

## Known limits of this test build

- Travel times assume clear roads; the rush-hour range is a city-wide average.
- Vercel Hobby is for non-commercial use, which fits a test. Move to Pro before any commercial use.
- The HeiGIT free plan has daily request limits; check the dashboard after the first day. Patas allows 60 searches per hour per client.
- Neon's free tier suspends an idle database, so the first request after a quiet period takes a few extra seconds.
- No jeepney, UV or train times yet.

## Rollback

Vercel keeps every deployment. From the project's Deployments page, promote the previous one, or run `vercel rollback`. Removing the Porkbun record takes the subdomain offline entirely.
