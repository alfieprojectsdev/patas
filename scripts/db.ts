/**
 * Database chores against DATABASE_URL (or the local PGlite dev database).
 *
 *   npm run db:migrate   apply new supabase/migrations/*.sql
 *   npm run db:purge     clear expired sealed cells, groups and rate-limit rows
 *
 * The app also purges opportunistically when a group is created, so a cron
 * job is optional.
 */
import { migrate, scriptDb } from "../src/lib/db.ts";
import { purgeExpired } from "../src/lib/groups.ts";

const cmd = process.argv[2];
const { db, source } = await scriptDb();
console.log(source);
if (cmd === "migrate") console.log("applied:", (await migrate(db)).join(", ") || "nothing new");
else if (cmd === "purge") {
  await purgeExpired(db);
  console.log("purged");
} else throw new Error("usage: db.ts migrate|purge");
process.exit(0);
