import React, { useState, useEffect } from 'react';

const SETTING_DEFS = [
  { key: 'default_duration', label: 'Default Duration (seconds)', type: 'number', min: 5, max: 600, default: '60' },
  { key: 'default_heading_offset', label: 'Default Heading Offset', type: 'range', min: -180, max: 180, step: 5, default: '0', unit: '\u00B0' },
  { key: 'default_pitch', label: 'Default Pitch', type: 'range', min: -90, max: 90, step: 5, default: '0', unit: '\u00B0' },
  { key: 'default_fov', label: 'Default Zoom / FOV', type: 'range', min: 20, max: 120, step: 5, default: '90', unit: '\u00B0' },
];

function hintText(key, val) {
  const v = Number(val);
  if (key === 'default_heading_offset') return v === 0 ? 'Forward' : v < 0 ? `${Math.abs(v)}\u00B0 Left` : `${v}\u00B0 Right`;
  if (key === 'default_pitch') return v === 0 ? 'Straight ahead' : v < 0 ? `${Math.abs(v)}\u00B0 Down` : `${v}\u00B0 Up`;
  if (key === 'default_fov') return v <= 40 ? 'Zoomed in' : v <= 80 ? 'Normal-close' : v <= 100 ? 'Normal' : 'Wide angle';
  if (key === 'default_duration') return v < 30 ? 'Fast' : v < 120 ? 'Normal' : 'Slow';
  return '';
}

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(setSettings);
    fetch('/api/cache/stats').then(r => r.json()).then(setCacheStats);
  }, []);

  const getValue = (key, def) => settings[key] ?? def;

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await resp.json();
      setSettings(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
    setSaving(false);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <h3>Default Walk Parameters</h3>
        <p className="form-hint" style={{ marginBottom: '1rem' }}>
          These defaults are used when creating new walks.
        </p>

        {SETTING_DEFS.map(def => {
          const val = getValue(def.key, def.default);
          return (
            <div className="form-group" key={def.key}>
              <label>{def.label} ({val}{def.unit || ''})</label>
              <input
                type={def.type}
                value={val}
                onChange={e => handleChange(def.key, e.target.value)}
                min={def.min}
                max={def.max}
                step={def.step}
              />
              <span className="form-hint">{hintText(def.key, val)}</span>
            </div>
          );
        })}

        <div className="editor-actions" style={{ marginTop: '1rem' }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      {cacheStats && (
        <div className="card" style={{ maxWidth: 600, marginTop: '1rem' }}>
          <h3>Image Cache</h3>
          <p>
            Cached images: <strong>{cacheStats.total_images}</strong>
            {' '} | Size: <strong>{formatBytes(cacheStats.total_bytes)}</strong>
          </p>
          <p className="form-hint">
            When a walk is generated, downloaded Street View images are cached. Re-scraping the same route with the same parameters reuses cached images instead of making new API calls.
          </p>
        </div>
      )}
    </div>
  );
}
