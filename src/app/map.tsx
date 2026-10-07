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
 * Load with next/dynamic and ssr:false: Leaflet touches `window` on import.
 */

// protomaps-leaflet reads Leaflet from a global.
(window as unknown as { L: typeof L }).L = L;

export type MapMember = { alias: string; color: string; hex: [number, number][] };
export type MapVenue = { venueId: string; rank: number; name: string; location: { lat: number; lng: number } | null };

// Same-origin by default. Set NEXT_PUBLIC_TILES_URL to serve the file from
// object storage (it must answer HTTP range requests and allow CORS).
const TILES_URL = process.env.NEXT_PUBLIC_TILES_URL || "/tiles/metro-manila.pmtiles";

const TILE_BOUNDS: L.LatLngBoundsExpression = [[14.54, 120.93], [14.83, 121.19]];
const QC_LATLNGS = QC_RING.map(([lng, lat]) => [lat, lng] as [number, number]);

/** Basemap from our own tiles plus the dashed QC boundary. Shared by the results map and the pin picker. */
export function createBaseMap(el: HTMLElement, view = { center: [14.65, 121.05] as [number, number], zoom: 12 }) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const m = L.map(el, { ...view, minZoom: 11, maxZoom: 18, maxBounds: TILE_BOUNDS, maxBoundsViscosity: 0.8 });
  leafletLayer({ url: TILES_URL, flavor: dark ? "dark" : "light", lang: "en", maxDataZoom: 15 }).addTo(m);
  L.polyline(QC_LATLNGS, { color: dark ? "#8fd3b4" : "#1f6f50", weight: 2, dashArray: "6 6", interactive: false }).addTo(m);
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
  const fitted = useRef("");

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = createBaseMap(el.current);
    overlay.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = overlay.current;
    if (!m || !g) return;
    g.clearLayers();
    const points: [number, number][] = [];

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
          L.polyline([centre(mb.hex), to], { color: mb.color, weight: 2, dashArray: "4 6", interactive: false }).addTo(g);
        }
      });
    }

    members.forEach((mb) => {
      L.polygon(mb.hex, { color: mb.color, weight: 2, fillColor: mb.color, fillOpacity: 0.35 })
        .bindTooltip(textEl(mb.alias), { permanent: true, direction: "top", className: "member-label", offset: [0, -6] })
        .addTo(g);
      points.push(...mb.hex);
    });

    venues.forEach((v) => {
      if (!v.location) return;
      const on = v.venueId === selected;
      L.marker([v.location.lat, v.location.lng], {
        icon: L.divIcon({
          className: "",
          html: `<span class="pin${on ? " on" : ""}">${v.rank}</span>`,
          iconSize: on ? [32, 32] : [24, 24],
          iconAnchor: on ? [16, 16] : [12, 12],
        }),
        zIndexOffset: on ? 1000 : 0,
        title: v.name,
        keyboard: true,
      })
        .bindTooltip(textEl(`${v.rank}. ${v.name}`), { direction: "right", offset: [12, 0] })
        .on("click", () => onSelect(v.venueId))
        .addTo(g);
      points.push([v.location.lat, v.location.lng]);
    });

    // Re-fit only when the set of points changes, so selecting a venue keeps the user's zoom.
    const key = JSON.stringify(points);
    if (points.length && key !== fitted.current) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
    }
  }, [members, venues, selected, onSelect]);

  return <div ref={el} className="map" role="region" aria-label="Map of members' landmarks and suggested venues" />;
}
