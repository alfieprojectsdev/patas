import type { NextConfig } from "next";

// The API routes read OSM snapshots from data/ at runtime; make sure they ship
// with the serverless bundle.
const config: NextConfig = {
  // PGlite (local dev database) loads its WASM from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/api/meet": ["./data/qc-venues.json", "./data/tables/**/*"],
    "/api/groups/[groupId]/meet": ["./data/qc-venues.json", "./data/tables/**/*"],
    "/api/landmarks": ["./data/qc-landmarks.json"],
  },
};

export default config;
