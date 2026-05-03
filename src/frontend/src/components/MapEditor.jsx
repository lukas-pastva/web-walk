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

function SearchControl({ onAddPoint }) {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef = useRef(null);
  const wrapperRef = useRef(null);

  // Disable Leaflet click propagation on the search container
  React.useEffect(() => {
    if (wrapperRef.current) {
      L.DomEvent.disableClickPropagation(wrapperRef.current);
      L.DomEvent.disableScrollPropagation(wrapperRef.current);
    }
  }, []);

  // Close dropdown on outside click
  React.useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doSearch = async (q) => {
    if (!q || q.trim().length < 5) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const bounds = map.getBounds();
      const viewbox = `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`;
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=7&viewbox=${viewbox}&bounded=0`
      );
      const data = await resp.json();
      setResults(data);
      setShowResults(data.length > 0);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setSearching(false);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => doSearch(val), 350);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    clearTimeout(timeoutRef.current);
    doSearch(query);
  };

  const handleSelect = (item) => {
    map.setView([parseFloat(item.lat), parseFloat(item.lon)], 16);
    setResults([]);
    setShowResults(false);
    setQuery(item.display_name.split(',').slice(0, 2).join(','));
  };

  const handleAddPoint = (e, item) => {
    e.stopPropagation();
    if (onAddPoint) {
      onAddPoint({ lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
    }
    setResults([]);
    setShowResults(false);
    setQuery(item.display_name.split(',').slice(0, 2).join(','));
    map.setView([parseFloat(item.lat), parseFloat(item.lon)], 16);
  };

  const handleFocus = () => {
    if (results.length > 0) setShowResults(true);
  };

  return (
    <div ref={wrapperRef} className="map-search" style={{
      position: 'absolute', top: 10, left: 50, zIndex: 1000,
      background: 'white', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      padding: '6px 10px', maxWidth: 'calc(100% - 100px)',
    }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder="Type 5+ chars to search..."
          style={{
            border: '1px solid #ddd', borderRadius: 4, padding: '6px 10px',
            fontSize: 14, width: 280, outline: 'none',
          }}
        />
        {searching && <span style={{ fontSize: 12, color: '#999' }}>...</span>}
      </form>
      {showResults && results.length > 0 && (
        <ul style={{
          listStyle: 'none', margin: '6px 0 0', padding: 0,
          maxHeight: 240, overflow: 'auto',
          borderTop: '1px solid #eee',
        }}>
          {results.map((r) => (
            <li key={r.place_id} onClick={() => handleSelect(r)} style={{
              padding: '8px 8px', cursor: 'pointer', fontSize: 13,
              borderBottom: '1px solid #eee', lineHeight: 1.3,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f0f4ff'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.display_name.split(',').slice(0, 2).join(',')}
                </div>
                <div style={{ color: '#888', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.display_name.split(',').slice(2).join(',').trim()}
                </div>
              </div>
              {onAddPoint && (
                <button
                  onClick={(e) => handleAddPoint(e, r)}
                  style={{
                    background: '#4a90d9', color: 'white', border: 'none',
                    borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
                    fontSize: 16, fontWeight: 700, lineHeight: 1, flexShrink: 0,
                  }}
                  title="Add as waypoint"
                >+</button>
              )}
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
      {!readonly && <SearchControl onAddPoint={onMapClick} />}
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
