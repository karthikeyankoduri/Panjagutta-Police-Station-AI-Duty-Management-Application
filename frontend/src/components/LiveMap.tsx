"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LiveLocation, googleMapsUrl, timeAgo } from "@/lib/api";

// Leaflet's default marker images are resolved relative to the CSS and break under bundlers;
// use the library's own CDN-hosted copies instead.
const ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function LiveMap({ locations }: { locations: LiveLocation[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [query, setQuery] = useState("");
  const markers = useRef<Map<number, L.Marker>>(new Map());
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const filtered = locations.filter((l) => {
    const q = query.trim().toLowerCase();
    return !q || [l.name, l.service_number, l.designation, l.sector_name, l.location_name].some((v) => (v || "").toLowerCase().includes(q));
  });

  // Selecting from the list focuses the marker on the map.
  const select = (l: LiveLocation) => {
    const open = selectedId !== l.staff_id;
    setSelectedId(open ? l.staff_id : null);
    if (open && map.current) {
      map.current.flyTo([l.latitude, l.longitude], Math.max(map.current.getZoom(), 15), { duration: 0.6 });
      markers.current.get(l.staff_id)?.openTooltip();
    }
  };

  // The map must re-measure itself when the panel width changes.
  useEffect(() => {
    const t = setTimeout(() => map.current?.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [wide]);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current).setView([17.4239, 78.4483], 12); // Panjagutta, Hyderabad
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // The site sends "Referrer-Policy: no-referrer", but OpenStreetMap blocks tile requests that
      // carry no referrer (403 "Access blocked"). Send just the origin, for tile requests only.
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    markers.current.clear();
    locations.forEach((l) => {
      const m = L.marker([l.latitude, l.longitude], { icon: ICON, title: l.name })
        .bindTooltip(l.name)
        .on("click", () => {
          setSelectedId(l.staff_id);
          setQuery("");
          setTimeout(() => rowRefs.current.get(l.staff_id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
        })
        .addTo(layer.current!);
      markers.current.set(l.staff_id, m);
    });
    // Fit once on first data so later refreshes don't yank the admin's view.
    if (!fitted.current && locations.length) {
      map.current.fitBounds(L.latLngBounds(locations.map((l) => [l.latitude, l.longitude] as [number, number])), {
        padding: [40, 40],
        maxZoom: 16,
      });
      fitted.current = true;
    }
  }, [locations]);

  const row = (label: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #e2e8f0", fontSize: 13 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
      <div
        ref={el}
        style={{ flex: "1 1 360px", height: "calc(100vh - 220px)", minHeight: 420, borderRadius: 8, minWidth: 0 }}
        aria-label="Live officer locations map"
      />
      <aside
        aria-label="Officers on the map"
        style={{
          flex: wide ? "0 0 560px" : "0 0 340px", maxWidth: "100%", height: "calc(100vh - 220px)", minHeight: 420,
          display: "flex", flexDirection: "column", background: "#fff", color: "#0f172a",
          border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, borderBottom: "1px solid #e2e8f0" }}>
          <strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>Officers ({filtered.length}/{locations.length})</strong>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            aria-label="Search officers"
            style={{ flex: 1, minWidth: 0, padding: "4px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setWide((w) => !w)}
            aria-label={wide ? "Shrink panel" : "Expand panel"}
            title={wide ? "Shrink panel" : "Expand panel"}
          >
            {wide ? "⇥" : "⇤"}
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filtered.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#64748b" }}>No officers to show.</div>}
          {filtered.map((l) => {
            const open = l.staff_id === selectedId;
            return (
              <div
                key={l.staff_id}
                ref={(n) => { if (n) rowRefs.current.set(l.staff_id, n); else rowRefs.current.delete(l.staff_id); }}
                style={{ borderBottom: "1px solid #e2e8f0", background: open ? "#eff6ff" : undefined }}
              >
                <button
                  onClick={() => select(l)}
                  aria-expanded={open}
                  style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", boxSizing: "border-box", padding: "10px 12px", gap: 8, alignItems: "center" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.designation} · {l.sector_name || "Station"} · {timeAgo(l.last_updated)}
                    </div>
                  </div>
                  <span aria-hidden>{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div style={{ padding: "0 12px 12px" }}>
                    {row("Service no.", l.service_number)}
                    {row("Designation", l.designation)}
                    {row("Sector", l.sector_name || "Station")}
                    {row("Location", l.location_name || "Address unavailable")}
                    {row("Coordinates", `${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}`)}
                    {row("Last updated", `${timeAgo(l.last_updated)} (${new Date(l.last_updated).toLocaleString()})`)}
                    <a
                      className="btn btn-primary btn-sm"
                      style={{ display: "inline-block", marginTop: 10 }}
                      href={googleMapsUrl(l.latitude, l.longitude)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Google Maps
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
