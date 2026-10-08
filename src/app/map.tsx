"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { leafletLayer } from "protomaps-leaflet";
import { QC_RING } from "@/lib/qc-boundary";

/**
 * Map of members' landmark cells and the ranked venues.
 *
 * Tiles: a Metro Manila PMTiles extract served from our own /public folder
 * (npm run fetch:tiles), drawn by protomaps-leaflet. No third-party tile
 * server sees which part of QC a member is looking at.
 *
 * Members are drawn as their ~200 m cell with an initial in it; names live in
 * the legend beside the map, so nothing floats over the pins. Venue pins that
 * would touch a hexagon or another pin are pushed out, with a leader line to a
 * dot at the true spot. The selected pin never moves and sits on top.
 *
 * Load with next/dynamic and ssr:false: Leaflet touches `window` on import.
 */

// protomaps-leaflet reads Leaflet from a global.
(window as unknown as { L: typeof L }).L = L;

export type MapMember = { initial: string; color: string; ink: string; hex: [number, number][] };
export type MapVenue = { venueId: string; rank: number; name: string; location: { lat: number; lng: number } | null };

// Same-origin by default. Set NEXT_PUBLIC_TILES_URL to serve the file from
// object storage (it must answer HTTP range requests and allow CORS).
const TILES_URL = process.env.NEXT_PUBLIC_TILES_URL || "/tiles/metro-manila.pmtiles";

const TILE_BOUNDS: L.LatLngBoundsExpression = [[14.54, 120.93], [14.83, 121.19]];
const QC_LATLNGS = QC_RING.map(([lng, lat]) => [lat, lng] as [number, number]);

/** A design token's current value (light or dark); Leaflet's SVG attributes can't take var(). */
export const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Basemap from our own tiles plus the dashed QC boundary. Shared by the results map and the pin picker. */
export function createBaseMap(el: HTMLElement, view = { center: [14.65, 121.05] as [number, number], zoom: 12 }) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const m = L.map(el, { ...view, minZoom: 11, maxZoom: 18, maxBounds: TILE_BOUNDS, maxBoundsViscosity: 0.8 });
  leafletLayer({ url: TILES_URL, flavor: dark ? "dark" : "light", lang: "en", maxDataZoom: 15 }).addTo(m);
  L.polyline(QC_LATLNGS, { color: cssVar("--qc-line", "#1f6f50"), weight: 2, dashArray: "6 6", opacity: 0.8, interactive: false }).addTo(m);
  return m;
}

/** Leaflet treats tooltip strings as HTML; nicknames and OSM names must go in as text. */
export const textEl = (s: string) => {
  const el = document.createElement("span");
  el.textContent = s;
  return el;
};

const centre = (hex: [number, number][]): [number, number] => [
  hex.reduce((s, p) => s + p[0], 0) / hex.length,
  hex.reduce((s, p) => s + p[1], 0) / hex.length,
];

// Where a pushed-out pin may go: rings at r+14, r+26, r+38 px, angles tried in this order.
const STEPS = [14, 26, 38];
const ANGLES = [-60, -120, 0, 180, -30, -150, 60, 120, 90, -90];

export default function MeetMap({
  members,
  venues,
  selected,
  onSelect,
}: {
  members: MapMember[];
  venues: MapVenue[];
  selected: string | null;
  onSelect: (venueId: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const fitted = useRef("");
  const latest = useRef({ members, venues, selected, onSelect });
  latest.current = { members, venues, selected, onSelect };

  /** Place venue pins in screen space; rerun whenever the zoom or size changes. */
  const layoutPins = useRef(() => {});
  layoutPins.current = () => {
    const m = map.current;
    const g = pins.current;
    if (!m || !g) return;
    g.clearLayers();
    const { members, venues, selected, onSelect } = latest.current;
    const size = m.getSize();
    const pinInk = cssVar("--pin", "#2f322e");
    const placed = members.map((mb) => {
      const c = m.latLngToContainerPoint(centre(mb.hex));
      const v = m.latLngToContainerPoint(mb.hex[0]);
      return { x: c.x, y: c.y, r: Math.max(13, c.distanceTo(v)) }; // 13 px: the badge
    });
    const order = venues
      .filter((v) => v.location)
      .sort((a, b) => (a.venueId === selected ? -1 : b.venueId === selected ? 1 : a.rank - b.rank));
    for (const v of order) {
      const on = v.venueId === selected;
      const r = on ? 16 : 12;
      const t = m.latLngToContainerPoint([v.location!.lat, v.location!.lng]);
      const free = (x: number, y: number) => placed.every((q) => Math.hypot(q.x - x, q.y - y) >= q.r + r + 2);
      let best = t;
      if (!on && !free(t.x, t.y)) {
        search: for (const step of STEPS) {
          for (const a of ANGLES) {
            const x = t.x + (r + step) * Math.cos((a * Math.PI) / 180);
            const y = t.y + (r + step) * Math.sin((a * Math.PI) / 180);
            if (free(x, y) && x > r && x < size.x - r && y > r && y < size.y - r) {
              best = L.point(x, y);
              break search;
            }
          }
        }
      }
      placed.push({ x: best.x, y: best.y, r });
      const at = m.containerPointToLatLng(best);
      if (best !== t) {
        L.polyline([[v.location!.lat, v.location!.lng], at], { color: pinInk, weight: 1.5, opacity: 1, interactive: false }).addTo(g);
        L.circleMarker([v.location!.lat, v.location!.lng], { radius: 3, stroke: false, fillColor: pinInk, fillOpacity: 1, interactive: false }).addTo(g);
      }
      L.marker(at, {
        icon: L.divIcon({
          className: "",
          html: `<span class="pin${on ? " on" : ""}">${v.rank}</span>`,
          iconSize: [r * 2, r * 2],
          iconAnchor: [r, r],
        }),
        zIndexOffset: on ? 1000 : -v.rank,
        title: `${v.rank}. ${v.name}`,
        keyboard: true,
      })
        .on("click", () => onSelect(v.venueId))
        .addTo(g);
    }
  };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = createBaseMap(el.current);
    overlay.current = L.layerGroup().addTo(m);
    pins.current = L.layerGroup().addTo(m);
    m.on("zoomend resize", () => layoutPins.current());
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      fitted.current = ""; // a new map (e.g. React's dev double-mount) must fit again
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = overlay.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: [number, number][] = [];
    const edge = cssVar("--bg", "#fbfaf7");

    // Trips to the selected venue: straight dashed lines, not routes.
    const target = venues.find((v) => v.venueId === selected);
    const hostIndex = target?.venueId.startsWith("member:m") ? Number(target.venueId.slice(8)) - 1 : -1;
    const to: [number, number] | null = target?.location
      ? [target.location.lat, target.location.lng]
      : hostIndex >= 0 && members[hostIndex]
        ? centre(members[hostIndex].hex)
        : null;
    if (to) {
      members.forEach((mb, i) => {
        if (i !== hostIndex) {
          L.polyline([centre(mb.hex), to], { color: mb.color, weight: 2.5, dashArray: "4 6", lineCap: "round", interactive: false }).addTo(g);
        }
      });
    }

    members.forEach((mb) => {
      L.polygon(mb.hex, { color: edge, weight: 2, fillColor: mb.color, fillOpacity: 0.85, interactive: false }).addTo(g);
      L.marker(centre(mb.hex), {
        // A hexagon badge on the cell, so the member reads at any zoom; the true cell outline is under it.
        icon: L.divIcon({ className: "", html: `<span class="hex map-hex"></span>`, iconSize: [22, 24], iconAnchor: [11, 12] }),
        interactive: false,
        keyboard: false,
      })
        .on("add", (e) => {
          // Set as text, never HTML: the initial comes from a nickname.
          const span = (e.target as L.Marker).getElement()?.querySelector(".map-hex") as HTMLElement | null;
          if (span) {
            span.textContent = mb.initial;
            span.style.background = mb.color;
            span.style.color = mb.ink;
          }
        })
        .addTo(g);
      points.push(...mb.hex);
    });
    venues.forEach((v) => v.location && points.push([v.location.lat, v.location.lng]));

    // Re-fit only when the set of points changes, so selecting a venue keeps the user's zoom.
    const key = JSON.stringify(points);
    if (points.length && key !== fitted.current) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    }
    layoutPins.current();
  }, [members, venues, selected, onSelect]);

  return <div ref={el} className="map" role="region" aria-label="Map of members' areas and suggested venues" />;
}
