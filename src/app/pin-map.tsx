"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { cellPolygon, snapToCell } from "@/lib/h3";
import { createBaseMap, textEl } from "./map";
import type { Landmark } from "./landmark-picker";

/**
 * Map for "Find it on the map": move the map under a fixed crosshair and the
 * res-9 cell beneath it is looked up for nearby landmarks. The cell is
 * snapped here, in the browser; only its id goes to the server.
 *
 * Load with next/dynamic and ssr:false (Leaflet and h3-js stay out of the
 * main bundle until someone opens the picker).
 */
export const PIN_MIN_ZOOM = 14; // below this the crosshair covers several barangays

export default function PinMap({
  landmarks,
  onCell,
  onPick,
}: {
  landmarks: Landmark[];
  onCell: (cell: string | null) => void;
  onPick: (l: Landmark) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const here = useRef<L.Polygon | null>(null);
  const marks = useRef<L.LayerGroup | null>(null);
  const cb = useRef({ onCell, onPick });
  useEffect(() => {
    cb.current = { onCell, onPick };
  });

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = createBaseMap(el.current, { center: [14.65, 121.05], zoom: 13 });
    marks.current = L.layerGroup().addTo(m);
    const update = () => {
      here.current?.remove();
      here.current = null;
      if (m.getZoom() < PIN_MIN_ZOOM) return cb.current.onCell(null);
      const c = m.getCenter();
      const cell = snapToCell({ lat: c.lat, lng: c.lng });
      here.current = L.polygon(cellPolygon(cell), { color: "#1f6f50", weight: 2, fillOpacity: 0.2, interactive: false }).addTo(m);
      cb.current.onCell(cell);
    };
    m.on("moveend", update);
    map.current = m;
    // The dialog has just opened; let Leaflet measure it.
    const t = setTimeout(() => {
      m.invalidateSize();
      update();
    }, 0);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const g = marks.current;
    if (!g) return;
    g.clearLayers();
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    landmarks.forEach((l) => {
      L.polygon(l.hex, { color: dark ? "#c9cfc7" : "#3d3f3b", weight: 1.5, dashArray: "4 4", fillOpacity: 0.12 })
        .bindTooltip(textEl(l.name), { direction: "top" })
        .on("click", () => cb.current.onPick(l))
        .addTo(g);
    });
  }, [landmarks]);

  return (
    <div className="pin-map-wrap">
      <div ref={el} className="map pin-map" role="region" aria-label="Map: move it so the crosshair is on your area" />
      <span className="crosshair" aria-hidden="true" />
    </div>
  );
}
