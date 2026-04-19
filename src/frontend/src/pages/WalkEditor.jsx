import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MapEditor from '../components/MapEditor';

export default function WalkEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [points, setPoints] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    fetch(`/api/walks/${id}`)
      .then((r) => r.json())
      .then((walk) => {
        setName(walk.name);
        setDuration(walk.duration_seconds);
        setPoints(walk.points.map((p) => ({ lat: p.lat, lng: p.lng })));
        setLoading(false);
      });
  }, [id, isEdit]);

  const handleMapClick = useCallback((latlng) => {
    setPoints((prev) => [...prev, { lat: latlng.lat, lng: latlng.lng }]);
  }, []);

  const handleRemovePoint = useCallback((index) => {
    setPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = async () => {
    if (points.length < 2) return;
    setSaving(true);

    const body = {
      name: name || 'Untitled Walk',
      duration_seconds: parseInt(duration) || 60,
      points,
    };

    try {
      let resp;
      if (isEdit) {
        resp = await fetch(`/api/walks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        resp = await fetch('/api/walks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const walk = await resp.json();
      navigate(`/walk/${walk.id}`);
    } catch (err) {
      console.error('Failed to save:', err);
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  return (
    <div className="page editor-page">
      <div className="page-header">
        <h2>{isEdit ? 'Edit Walk' : 'New Walk'}</h2>
      </div>

      <div className="editor-layout">
        <div className="editor-sidebar">
          <div className="form-group">
            <label>Walk Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My walk through the city..."
            />
          </div>

          <div className="form-group">
            <label>Video Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              min="5"
              max="600"
            />
            <span className="form-hint">
              {duration < 30 ? 'Fast' : duration < 120 ? 'Normal' : 'Slow'} playback
            </span>
          </div>

          <div className="form-group">
            <label>Waypoints ({points.length})</label>
            <div className="points-list">
              {points.map((p, i) => (
                <div key={i} className="point-item">
                  <span className="point-number">{i + 1}</span>
                  <span className="point-coords">
                    {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                  </span>
                  <button
                    className="btn-icon"
                    onClick={() => handleRemovePoint(i)}
                    title="Remove point"
                  >
                    &times;
                  </button>
                </div>
              ))}
              {points.length === 0 && (
                <p className="form-hint">Click on the map to add waypoints</p>
              )}
            </div>
          </div>

          <div className="editor-actions">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={points.length < 2 || saving}
            >
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Walk'}
            </button>
            <button className="btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </div>

        <div className="editor-map">
          <MapEditor points={points} onMapClick={handleMapClick} />
        </div>
      </div>
    </div>
  );
}
