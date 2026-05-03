import React, { useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents, useMap } from 'react-leaflet';
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

function SearchControl() {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timeoutRef = useRef(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
      );
      const data = await resp.json();
      setResults(data);
      if (data.length > 0) {
        map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
        setResults([]);
      }
    } catch (err) {
      console.error('Search failed:', err);
    }
    setSearching(false);
  };

  const handleSelect = (item) => {
    map.setView([parseFloat(item.lat), parseFloat(item.lon)], 16);
    setResults([]);
    setQuery(item.display_name.split(',').slice(0, 2).join(','));
  };

  return (
    <div className="map-search" style={{
      position: 'absolute', top: 10, left: 50, zIndex: 1000,
      background: 'white', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      padding: '6px 10px', maxWidth: 'calc(100% - 100px)',
    }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address or place..."
          style={{
            border: '1px solid #ddd', borderRadius: 4, padding: '6px 10px',
            fontSize: 14, width: 250, outline: 'none',
          }}
        />
        <button type="submit" disabled={searching} style={{
          background: '#4a90d9', color: 'white', border: 'none',
          borderRadius: 4, padding: '6px 12px', cursor: 'pointer', fontSize: 14,
        }}>
          {searching ? '...' : 'Search'}
        </button>
      </form>
      {results.length > 1 && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 200, overflow: 'auto' }}>
          {results.map((r) => (
            <li key={r.place_id} onClick={() => handleSelect(r)} style={{
              padding: '6px 8px', cursor: 'pointer', fontSize: 13,
              borderBottom: '1px solid #eee',
            }}>
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FitBounds({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  React.useEffect(() => {
    if (points.length >= 1 && !fitted.current) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      fitted.current = true;
    }
  }, [points, map]);
  return null;
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
    <MapContainer center={[48.15, 17.11]} zoom={13} className="map-container" style={{ width: '100%', height: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {!readonly && <SearchControl />}
      {points.length >= 1 && <FitBounds points={points} />}
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
