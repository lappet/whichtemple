import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { Temple } from "./temples";

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// Popups only need a small rendition of the Commons thumbnail.
const thumb = (url: string) => url.replace(/([?&]width=)\d+/, "$1360");

export default function MapPage({ temples }: { temples: Temple[] }) {
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    const map = L.map(canvas.current, {
      center: [22.5, 79.5],
      zoom: 5,
      minZoom: 4,
      maxBounds: [
        [-5, 45],
        [45, 110],
      ],
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 55,
    });
    for (const t of temples) {
      if (t.lat == null || t.lon == null) continue;
      const marker = L.circleMarker([t.lat, t.lon], {
        radius: 6,
        color: "#d9922e",
        weight: 1,
        fillColor: "#d9922e",
        fillOpacity: 0.75,
      });
      marker.bindPopup(
        `<a class="map-pop" href="/${t.qid}">` +
          `<img src="${thumb(t.image)}" alt="" loading="lazy" />` +
          `<span>${esc(t.name)}</span>` +
          `</a>`,
        { minWidth: 230 }
      );
      cluster.addLayer(marker);
    }
    map.addLayer(cluster);

    return () => {
      map.remove();
    };
  }, [temples]);

  return (
    <div className="map-page">
      <header className="masthead">
        <a className="masthead-mark" href="/">
          Which Temple?
        </a>
        <span className="masthead-note">
          {temples.length.toLocaleString("en-IN")} temples — zoom in and tap a
          marker
        </span>
      </header>
      <div className="map-canvas" ref={canvas} />
    </div>
  );
}
