import React from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icons in bundled builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const COLORS = ['#67c23a', '#4a90d9', '#e6a23c', '#f56c6c', '#9b59b6', '#1abc9c'];

function makeIcon(color) {
  return new L.DivIcon({
    className: 'custom-marker',
    html: `<div style="
      background: ${color};
      width: 28px;
      height: 28px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
}

function ClickHandler({ onClick, readonly }) {
  useMapEvents({
    click(e) {
      if (!readonly) onClick(e.latlng);
    },
  });
  return null;
}

export default function MapEditor({ points, onMapClick, readonly }) {
  const positions = points.map((p) => [p.lat, p.lng]);

  return (
    <MapContainer center={[48.15, 17.11]} zoom={13} className="map-container">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onMapClick} readonly={readonly} />
      {points.map((p, i) => (
        <Marker
          key={i}
          position={[p.lat, p.lng]}
          icon={makeIcon(COLORS[i % COLORS.length])}
        />
      ))}
      {positions.length >= 2 && (
        <Polyline positions={positions} color="#4a90d9" weight={3} dashArray="8 4" />
      )}
    </MapContainer>
  );
}
