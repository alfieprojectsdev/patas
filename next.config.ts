import type { NextConfig } from "next";

// The API routes read OSM snapshots from data/ at runtime; make sure they ship
// with the serverless bundle.
const config: NextConfig = {
  // PGlite (local dev database) loads its WASM from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/api/meet": ["./data/mm-venues.json", "./data/rail.json", "./data/tables/**/*"],
    "/api/groups/[groupId]/meet": ["./data/mm-venues.json", "./data/rail.json", "./data/tables/**/*"],
    "/api/landmarks": ["./data/mm-landmarks.json"],
    // Venue search tags each venue with its nearest landmark, so it needs both snapshots.
    "/api/venues": ["./data/mm-venues.json", "./data/mm-landmarks.json"],
  },
};

export default config;
