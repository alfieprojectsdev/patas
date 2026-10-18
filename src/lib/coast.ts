/**
 * Clip a boundary ring to land with OpenStreetMap coastline ways. Used by
 * scripts/fetch-boundary.ts only: OSM's Metro Manila boundary takes in
 * Manila Bay (the City of Manila's outline reaches longitude 120.79, about
 * 17 km offshore), which looks wrong on the map and puts water cells into
 * precompute.
 *
 * OSM coastline ways run with land on the left. A ring vertex is at sea if
 * the nearest coastline segment has it on the right. Each run of sea vertices
 * is replaced by the coastline between the points where the ring leaves and
 * rejoins the land.
 *
 * Coordinates are GeoJSON order [lng, lat]; distances use a local flat
 * approximation, fine at city scale.
 */
export type Pt = [number, number];
export type CoastWay = { nodes: number[]; geometry: { lat: number; lon: number }[] };

const KM_PER_DEG = 111.32;

/** Pure: join coastline ways that share end nodes into chains, keeping their direction. */
export function stitch(ways: CoastWay[]): Pt[][] {
  const chains = ways.map((w) => ({ nodes: [...w.nodes], pts: w.geometry.map((g) => [g.lon, g.lat] as Pt) }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < chains.length && !merged; i++) {
      for (let j = 0; j < chains.length && !merged; j++) {
        if (i === j || chains[i].nodes.at(-1) !== chains[j].nodes[0]) continue;
        chains[i] = { nodes: [...chains[i].nodes, ...chains[j].nodes.slice(1)], pts: [...chains[i].pts, ...chains[j].pts.slice(1)] };
        chains.splice(j, 1);
        merged = true;
      }
    }
  }
  return chains.map((c) => c.pts);
}

type Near = { chain: number; seg: number; t: number; km: number; left: boolean };

function nearest(p: Pt, chains: Pt[][]): Near {
  const kx = KM_PER_DEG * Math.cos((p[1] * Math.PI) / 180);
  let best: Near = { chain: -1, seg: -1, t: 0, km: Infinity, left: true };
  chains.forEach((c, ci) => {
    for (let i = 0; i < c.length - 1; i++) {
      const ax = (c[i][0] - p[0]) * kx, ay = (c[i][1] - p[1]) * KM_PER_DEG;
      const bx = (c[i + 1][0] - p[0]) * kx, by = (c[i + 1][1] - p[1]) * KM_PER_DEG;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const km = Math.hypot(ax + t * dx, ay + t * dy);
      // p is the origin here, so p - a = (-ax, -ay); left of a→b when the cross product is positive.
      if (km < best.km) best = { chain: ci, seg: i, t, km, left: dx * -ay - dy * -ax > 0 };
    }
  });
  return best;
}

/** Where segment p→q first crosses chain `c`, as a position (segment index + fraction) and point. */
function crossing(p: Pt, q: Pt, c: Pt[]): { pos: number; pt: Pt } | null {
  let found: { pos: number; pt: Pt; u: number } | null = null;
  for (let i = 0; i < c.length - 1; i++) {
    const [ax, ay] = c[i], [bx, by] = c[i + 1];
    const d = (q[0] - p[0]) * (by - ay) - (q[1] - p[1]) * (bx - ax);
    if (!d) continue;
    const u = ((ax - p[0]) * (by - ay) - (ay - p[1]) * (bx - ax)) / d; // along p→q
    const t = ((ax - p[0]) * (q[1] - p[1]) - (ay - p[1]) * (q[0] - p[0])) / d; // along a→b
    if (u >= 0 && u <= 1 && t >= 0 && t <= 1 && (!found || u < found.u)) {
      found = { pos: i + t, pt: [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])], u };
    }
  }
  return found && { pos: found.pos, pt: found.pt };
}

/** Coastline points strictly between two positions on a chain, in travel order. */
function between(c: Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  if (from <= to) for (let i = Math.floor(from) + 1; i <= Math.ceil(to) - 1; i++) out.push(c[i]);
  else for (let i = Math.ceil(from) - 1; i >= Math.floor(to) + 1; i--) out.push(c[i]);
  return out;
}

/**
 * Pure. The part of a closed ring that's on land. Vertices within `onCoastKm`
 * of the coastline count as land (boundaries often share the coastline's nodes).
 * Throws if a sea stretch can't be matched to one coastline chain.
 */
export function clipToLand(ring: Pt[], chains: Pt[][], onCoastKm = 0.05): { ring: Pt[]; seaVertices: number } {
  const open = ring.slice(0, -1);
  const near = open.map((p) => nearest(p, chains));
  const sea = near.map((n) => n.km > onCoastKm && !n.left);
  const seaVertices = sea.filter(Boolean).length;
  if (!seaVertices) return { ring, seaVertices };
  const start = sea.indexOf(false);
  if (start < 0) throw new Error("the whole ring is at sea");
  const n = open.length;
  const out: Pt[] = [];
  for (let k = 0; k < n; ) {
    const i = (start + k) % n;
    if (!sea[i]) {
      out.push(open[i]);
      k++;
      continue;
    }
    // A run of sea vertices from i to j - 1; land at i - 1 and j.
    let len = 0;
    while (sea[(i + len) % n]) len++;
    const before = open[(i - 1 + n) % n];
    const after = open[(i + len) % n];
    const ci = near[i].chain;
    const leave = crossing(before, open[i], chains[ci]) ?? { pos: near[(i - 1 + n) % n].seg + near[(i - 1 + n) % n].t, pt: before };
    const last = (i + len - 1) % n;
    const rejoin = crossing(after, open[last], chains[ci]) ?? { pos: near[(i + len) % n].seg + near[(i + len) % n].t, pt: after };
    if (near[last].chain !== ci) throw new Error(`a sea stretch of the ring spans two coastline chains (vertices ${i}-${last})`);
    out.push(leave.pt, ...between(chains[ci], leave.pos, rejoin.pos), rejoin.pt);
    k += len;
  }
  out.push(out[0]);
  return { ring: out.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as Pt), seaVertices };
}
