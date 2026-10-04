// Core domain types. Coordinates appear ONLY in request-scoped types —
// nothing with lat/lng is ever persisted (see CLAUDE.md, privacy rules).

export type LatLng = { lat: number; lng: number };

export type TravelMode = "DRIVE" | "WALK" | "TRANSIT" | "TWO_WHEELER";

/** A member's starting point for ONE request. Never stored. */
export type Origin = {
  memberId: string; // opaque alias, e.g. "m1" — not a name
  landmark: LatLng; // user-picked landmark, not a home address
};

export type Venue = {
  venueId: string; // Places id, or "member:<memberId>" for a home option
  name: string;
  location: LatLng;
  tags: string[]; // e.g. ["cafe", "wifi"]
};

/** cost[i][j] = cost for member i to reach venue j. null = unreachable. */
export type CostMatrix = (number | null)[][];

export type VenueScore = {
  venue: Venue;
  worst: number; // minimax objective (includes prior burden if rotating)
  spread: number; // max - min this meeting
  total: number; // sum this meeting
  perMember: number[]; // this meeting's cost per member (same order as origins)
};
