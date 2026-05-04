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
  const [country, setCountry] = useState(null); // { name, code, lat, lon, boundingbox }
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const step = country ? 'place' : 'country';

  React.useEffect(() => {
    if (wrapperRef.current) {
      L.DomEvent.disableClickPropagation(wrapperRef.current);
      L.DomEvent.disableScrollPropagation(wrapperRef.current);
    }
  }, []);

  React.useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchCountry = async (q) => {
    if (!q || q.trim().length < 2) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=7&featuretype=country&addressdetails=1`
      );
      const data = await resp.json();
      setResults(data);
      setShowResults(data.length > 0);
    } catch (err) {
      console.error('Country search failed:', err);
    }
    setSearching(false);
  };

  const searchPlace = async (q) => {
    if (!q || q.trim().length < 2) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const countryCode = country.code ? `&countrycodes=${country.code}` : '';
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=7${countryCode}&addressdetails=1`
      );
      const data = await resp.json();
      setResults(data);
      setShowResults(data.length > 0);
    } catch (err) {
      console.error('Place search failed:', err);
    }
    setSearching(false);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timeoutRef.current);
    const fn = step === 'country' ? searchCountry : searchPlace;
    timeoutRef.current = setTimeout(() => fn(val), 350);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    clearTimeout(timeoutRef.current);
    if (step === 'country') searchCountry(query);
    else searchPlace(query);
  };

  const handleSelectCountry = (item) => {
    const cc = item.address?.country_code?.toUpperCase() || '';
    const name = item.address?.country || item.display_name.split(',')[0];
    setCountry({ name, code: cc, lat: item.lat, lon: item.lon, boundingbox: item.boundingbox });
    if (item.boundingbox) {
      const bb = item.boundingbox.map(Number);
      map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { padding: [20, 20], maxZoom: 7 });
    } else {
      map.setView([parseFloat(item.lat), parseFloat(item.lon)], 6);
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSelectPlace = (item) => {
    if (item.boundingbox) {
      const bb = item.boundingbox.map(Number);
      map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { padding: [30, 30], maxZoom: 16 });
    } else {
      map.setView([parseFloat(item.lat), parseFloat(item.lon)], 16);
    }
    setResults([]);
    setShowResults(false);
    setQuery(item.display_name.split(',').slice(0, 2).join(',').trim());
  };

  const handleAddPoint = (e, item) => {
    e.stopPropagation();
    if (onAddPoint) {
      onAddPoint({ lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
    }
    setResults([]);
    setShowResults(false);
    setQuery(item.display_name.split(',').slice(0, 2).join(',').trim());
    if (item.boundingbox) {
      const bb = item.boundingbox.map(Number);
      map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { padding: [30, 30], maxZoom: 16 });
    } else {
      map.setView([parseFloat(item.lat), parseFloat(item.lon)], 16);
    }
  };

  const handleClearCountry = () => {
    setCountry(null);
    setQuery('');
    setResults([]);
    setShowResults(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleFocus = () => {
    if (results.length > 0) setShowResults(true);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Backspace' && query === '' && country) {
      handleClearCountry();
    }
  };

  const getTypeIcon = (item) => {
    const t = (item.type || '').toLowerCase();
    const c = (item.class || '').toLowerCase();
    if (t === 'country' || t === 'state') return '\u{1F3F3}';
    if (t === 'city' || t === 'town' || t === 'village' || t === 'hamlet') return '\u{1F3D8}';
    if (c === 'highway' || c === 'road') return '\u{1F6E3}';
    if (c === 'tourism' || c === 'leisure') return '\u{26F1}';
    if (c === 'natural') return '\u{1F3D4}';
    return '\u{1F4CD}';
  };

  return (
    <div ref={wrapperRef} className="search-control">
      <form onSubmit={handleSubmit} className="search-form">
        {country && (
          <span className="search-country-tag" onClick={handleClearCountry} title="Click to change country">
            <span className="search-country-tag-text">{country.code || country.name}</span>
            <span className="search-country-tag-x">&times;</span>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={step === 'country' ? 'Country (e.g. Spain)...' : `Search in ${country.name}...`}
          className="search-input"
        />
        {searching && (
          <span className="search-spinner">
            <span className="search-spinner-dot"></span>
            <span className="search-spinner-dot"></span>
            <span className="search-spinner-dot"></span>
          </span>
        )}
      </form>

      {step === 'country' && !showResults && !searching && query === '' && (
        <div className="search-hint">
          <span className="search-hint-step">1</span> Start by picking a country
        </div>
      )}
      {step === 'place' && !showResults && !searching && query === '' && (
        <div className="search-hint">
          <span className="search-hint-step">2</span> Now search for a place
        </div>
      )}

      <ul className={`search-results ${showResults && results.length > 0 ? 'search-results-visible' : ''}`}>
        {results.map((r, idx) => (
          <li
            key={r.place_id}
            className="search-result-item"
            style={{ animationDelay: `${idx * 40}ms` }}
            onClick={() => step === 'country' ? handleSelectCountry(r) : handleSelectPlace(r)}
          >
            <span className="search-result-icon">{getTypeIcon(r)}</span>
            <div className="search-result-text">
              <div className="search-result-name">
                {r.display_name.split(',').slice(0, 2).join(',').trim()}
              </div>
              <div className="search-result-detail">
                {r.display_name.split(',').slice(2).join(',').trim()}
              </div>
            </div>
            {step === 'place' && onAddPoint && (
              <button
                onClick={(e) => handleAddPoint(e, r)}
                className="search-add-btn"
                title="Add as waypoint"
              >+</button>
            )}
          </li>
        ))}
      </ul>
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
