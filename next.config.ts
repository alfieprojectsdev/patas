import type { NextConfig } from "next";

// The API routes read OSM snapshots from data/ at runtime; make sure they ship
// with the serverless bundle.
const config: NextConfig = {
  outputFileTracingIncludes: {
    "/api/meet": ["./data/qc-venues.json", "./data/tables/**/*"],
    "/api/landmarks": ["./data/qc-landmarks.json"],
  },
};

export default config;
