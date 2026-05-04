import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MapEditor from '../components/MapEditor';

export default function WalkEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState('');
  const [duration, setDuration] = useState(60);
  const [headingOffset, setHeadingOffset] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [fov, setFov] = useState(90);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [points, setPoints] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [walkStatus, setWalkStatus] = useState('draft');
  const [originalAspectRatio, setOriginalAspectRatio] = useState(null);
  const [originalDuration, setOriginalDuration] = useState(null);

  useEffect(() => {
    if (isEdit) {
      fetch(`/api/walks/${id}`)
        .then((r) => r.json())
        .then((walk) => {
          setName(walk.name);
          setDuration(walk.duration_seconds);
          setHeadingOffset(walk.heading_offset || 0);
          setPitch(walk.pitch || 0);
          setFov(walk.fov || 90);
          setAspectRatio(walk.aspect_ratio || '1:1');
          setOriginalAspectRatio(walk.aspect_ratio || '1:1');
          setOriginalDuration(walk.duration_seconds);
          setPoints(walk.points.map((p) => ({ lat: p.lat, lng: p.lng })));
          setWalkStatus(walk.status);
          setLoading(false);
        });
    } else {
      // Load defaults from settings for new walks
      fetch('/api/settings')
        .then((r) => r.json())
        .then((s) => {
          if (s.default_duration) setDuration(Number(s.default_duration));
          if (s.default_heading_offset) setHeadingOffset(Number(s.default_heading_offset));
          if (s.default_pitch) setPitch(Number(s.default_pitch));
          if (s.default_fov) setFov(Number(s.default_fov));
          if (s.default_aspect_ratio) setAspectRatio(s.default_aspect_ratio);
        })
        .catch(() => {});
    }
  }, [id, isEdit]);

  const isDraft = walkStatus === 'draft';

  const handleMapClick = useCallback((latlng) => {
    setPoints((prev) => [...prev, { lat: latlng.lat, lng: latlng.lng }]);
  }, []);

  const handleRemovePoint = useCallback((index) => {
    setPoints((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = async () => {
    if (isDraft && points.length < 2) return;
    setSaving(true);

    const body = {
      name: name || 'Untitled Walk',
      duration_seconds: parseInt(duration) || 60,
      aspect_ratio: aspectRatio,
    };

    // Only send route/camera params for draft walks
    if (isDraft) {
      body.heading_offset = parseFloat(headingOffset) || 0;
      body.pitch = parseFloat(pitch) || 0;
      body.fov = parseFloat(fov) || 90;
      body.points = points;
    }

    try {
      let resp;
      if (isEdit) {
        resp = await fetch(`/api/walks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        body.heading_offset = parseFloat(headingOffset) || 0;
        body.pitch = parseFloat(pitch) || 0;
        body.fov = parseFloat(fov) || 90;
        body.points = points;
        resp = await fetch('/api/walks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const walk = await resp.json();
      const needsRegenerate = !isDraft && (
        (originalAspectRatio && aspectRatio !== originalAspectRatio) ||
        (originalDuration !== null && parseInt(duration) !== originalDuration)
      );
      navigate(`/walk/${walk.id}${needsRegenerate ? '?regenerate=1' : ''}`);
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
        {isEdit && !isDraft && (
          <span className="form-hint">Only name, duration and format can be changed after generating.</span>
        )}
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
            <label>Video Format</label>
            <div className="aspect-ratio-options">
              {['1:1', '3:2', '4:3', '16:9'].map((ar) => (
                <button
                  key={ar}
                  type="button"
                  className={`aspect-btn ${aspectRatio === ar ? 'active' : ''}`}
                  onClick={() => setAspectRatio(ar)}
                >
                  {ar}
                </button>
              ))}
            </div>
            <span className="form-hint">
              {aspectRatio === '1:1' ? 'Square' : aspectRatio === '3:2' ? 'Photo' : aspectRatio === '4:3' ? 'Classic' : 'Widescreen'}
            </span>
          </div>

          {isDraft && (
            <>
              <div className="form-group">
                <label>Heading Offset ({headingOffset}°)</label>
                <input
                  type="range"
                  value={headingOffset}
                  onChange={(e) => setHeadingOffset(Number(e.target.value))}
                  min="-180"
                  max="180"
                  step="5"
                />
                <span className="form-hint">
                  {headingOffset === 0 ? 'Forward' : headingOffset < 0 ? `${Math.abs(headingOffset)}° Left` : `${headingOffset}° Right`}
                </span>
              </div>

              <div className="form-group">
                <label>Pitch ({pitch}°)</label>
                <input
                  type="range"
                  value={pitch}
                  onChange={(e) => setPitch(Number(e.target.value))}
                  min="-90"
                  max="90"
                  step="5"
                />
                <span className="form-hint">
                  {pitch === 0 ? 'Straight ahead' : pitch < 0 ? `${Math.abs(pitch)}° Down` : `${pitch}° Up`}
                </span>
              </div>

              <div className="form-group">
                <label>Zoom / FOV ({fov}°)</label>
                <input
                  type="range"
                  value={fov}
                  onChange={(e) => setFov(Number(e.target.value))}
                  min="20"
                  max="120"
                  step="5"
                />
                <span className="form-hint">
                  {fov <= 40 ? 'Zoomed in' : fov <= 80 ? 'Normal-close' : fov <= 100 ? 'Normal' : 'Wide angle'}
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
            </>
          )}

          <div className="editor-actions">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={(isDraft && points.length < 2) || saving}
            >
              {saving ? <><span className="btn-spinner"></span> Saving...</> : isEdit ? 'Save Changes' : 'Create Walk'}
            </button>
            <button className="btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </div>

        {isDraft && (
          <div className="editor-map">
            <MapEditor points={points} onMapClick={handleMapClick} />
          </div>
        )}
      </div>
    </div>
  );
}
