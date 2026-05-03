import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MapEditor from '../components/MapEditor';

const API_COSTS = { directions: 0.005, streetview: 0.007 };

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateCost(points) {
  if (!points || points.length < 2) return null;
  // Straight-line distance (route is typically 1.3-1.5x longer)
  let straightDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    straightDist += haversine(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  const routeFactor = 1.4;
  const estRouteM = straightDist * routeFactor;
  const directionRequests = points.length - 1;
  const estFrames = Math.ceil(estRouteM / 15);
  const dirCost = directionRequests * API_COSTS.directions;
  const svCost = estFrames * API_COSTS.streetview;
  return {
    distanceKm: (estRouteM / 1000).toFixed(1),
    directionRequests,
    estFrames,
    dirCost,
    svCost,
    totalCost: dirCost + svCost,
    totalRequests: directionRequests + estFrames,
  };
}

function CostEstimate({ points, walkId, onConfirm, onCancel }) {
  const est = estimateCost(points);
  const [cacheEst, setCacheEst] = useState(null);

  useEffect(() => {
    if (!walkId) return;
    fetch(`/api/walks/${walkId}/estimate-cache`)
      .then((r) => r.json())
      .then(setCacheEst)
      .catch(() => {});
  }, [walkId]);

  if (!est) return null;

  const cached = cacheEst?.cachedFrames || 0;
  const savedCost = cacheEst?.savedCost || 0;
  const newFrames = cached > 0 ? Math.max(0, est.estFrames - cached) : est.estFrames;
  const newSvCost = newFrames * API_COSTS.streetview;
  const actualTotal = est.dirCost + newSvCost;

  return (
    <div className="cost-estimate">
      <h4>Cost Estimate</h4>
      <div className="cost-rows">
        <div className="cost-row">
          <span>Route distance (est.)</span>
          <span>{est.distanceKm} km</span>
        </div>
        <div className="cost-row">
          <span>Directions API ({est.directionRequests} req)</span>
          <span>${est.dirCost.toFixed(3)}</span>
        </div>
        <div className="cost-row">
          <span>Street View ({est.estFrames} frames total)</span>
          <span>${est.svCost.toFixed(2)}</span>
        </div>
        {cached > 0 && (
          <>
            <div className="cost-row cost-saved">
              <span>Cached frames (no API cost)</span>
              <span>{cached} frames (-${savedCost.toFixed(2)})</span>
            </div>
            <div className="cost-row">
              <span>New downloads needed</span>
              <span>{newFrames} frames (${newSvCost.toFixed(2)})</span>
            </div>
          </>
        )}
        <div className="cost-row cost-total">
          <span>Total ({est.directionRequests + newFrames} API requests)</span>
          <span>${actualTotal.toFixed(2)}</span>
        </div>
        {cached > 0 && (
          <div className="cost-row cost-saved">
            <span>You save</span>
            <span>${savedCost.toFixed(2)} ({cached} cached images)</span>
          </div>
        )}
      </div>
      <div className="cost-actions">
        <button className="btn-primary" onClick={onConfirm}>Confirm Generate</button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function LogWindow({ walkId, visible }) {
  const [logs, setLogs] = useState([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logWindowRef = useRef(null);
  const sinceRef = useRef('1970-01-01');
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    if (!visible) return;
    const fetchLogs = async () => {
      // Check if scrolled to bottom before adding new logs
      const el = logWindowRef.current;
      if (el) {
        wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      }
      try {
        const resp = await fetch(`/api/walks/${walkId}/logs?since=${encodeURIComponent(sinceRef.current)}`);
        const data = await resp.json();
        if (data.length > 0) {
          setLogs((prev) => [...prev, ...data]);
          sinceRef.current = data[data.length - 1].created_at;
        }
      } catch (e) {}
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 1500);
    return () => clearInterval(interval);
  }, [walkId, visible]);

  useEffect(() => {
    const el = logWindowRef.current;
    if (el && wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  // Reset when walk restarts
  useEffect(() => {
    if (visible) {
      setLogs([]);
      sinceRef.current = '1970-01-01';
    }
  }, [visible]);

  // Escape to exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const handleCopy = () => {
    const text = logs.map((l) =>
      `${new Date(l.created_at).toLocaleTimeString()} [${l.level}] ${l.message}`
    ).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!visible) return null;

  return (
    <div className={`info-card log-card ${fullscreen ? 'log-fullscreen' : ''}`}>
      <div className="log-header">
        <h3>Processing Log</h3>
        <div className="log-actions">
          <button className="log-btn" onClick={handleCopy} title="Copy logs">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button className="log-btn" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? '\u2716' : '\u2922'}
          </button>
        </div>
      </div>
      <div className="log-window" ref={logWindowRef}>
        {logs.length === 0 && (
          <div className="log-line log-info">Waiting for logs...</div>
        )}
        {logs.map((l) => (
          <div key={l.id} className={`log-line log-${l.level}`}>
            <span className="log-time">
              {new Date(l.created_at).toLocaleTimeString()}
            </span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WalkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [walk, setWalk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rateLimitError, setRateLimitError] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);

  const fetchWalk = async () => {
    try {
      const resp = await fetch(`/api/walks/${id}`);
      if (!resp.ok) {
        navigate('/');
        return;
      }
      setWalk(await resp.json());
    } catch (err) {
      console.error('Failed to fetch walk:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWalk();
  }, [id]);

  // Poll while processing
  useEffect(() => {
    if (!walk || (walk.status !== 'pending' && walk.status !== 'processing')) return;
    const interval = setInterval(fetchWalk, 2000);
    return () => clearInterval(interval);
  }, [walk?.status]);

  // Show logs automatically when processing starts
  useEffect(() => {
    if (walk && (walk.status === 'pending' || walk.status === 'processing')) {
      setShowLogs(true);
    }
  }, [walk?.status]);

  const handleGenerateClick = () => {
    setShowEstimate(true);
  };

  const handleGenerateConfirm = async () => {
    setShowEstimate(false);
    setRateLimitError(null);
    setShowLogs(true);
    const resp = await fetch(`/api/walks/${id}/generate`, { method: 'POST' });
    if (resp.status === 429) {
      const data = await resp.json();
      setRateLimitError(data.message);
      setShowLogs(false);
      return;
    }
    fetchWalk();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this walk?')) return;
    await fetch(`/api/walks/${id}`, { method: 'DELETE' });
    navigate('/');
  };

  const handleReprocess = async () => {
    await fetch(`/api/walks/${id}/reprocess`, { method: 'POST' });
    await fetchWalk();
    setShowEstimate(true);
  };

  const handleDeleteVideo = async () => {
    if (!confirm('Delete video? Walk will be reset to draft.')) return;
    await fetch(`/api/walks/${id}/video`, { method: 'DELETE' });
    setShowLogs(false);
    fetchWalk();
  };

  if (loading || !walk) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  const isProcessing = walk.status === 'pending' || walk.status === 'processing';
  const isDone = walk.status === 'done';
  const isError = walk.status === 'error';
  const progress = walk.total_frames > 0
    ? Math.round((walk.downloaded_frames / walk.total_frames) * 100)
    : 0;

  return (
    <div className="page detail-page">
      <div className="page-header">
        <h2>{walk.name}</h2>
        <div className="header-actions">
          {walk.status === 'draft' && (
            <button className="btn-secondary" onClick={() => navigate(`/walk/${id}/edit`)}>
              Edit
            </button>
          )}
          <button className="btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-info">
          <div className="info-card">
            <h3>Walk Info</h3>
            <div className="info-row">
              <span className="info-label">Status</span>
              <span className={`status-text status-${walk.status}`}>
                {walk.status.charAt(0).toUpperCase() + walk.status.slice(1)}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Duration</span>
              <span>{walk.duration_seconds}s</span>
            </div>
            <div className="info-row">
              <span className="info-label">Waypoints</span>
              <span>{walk.points?.length || 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Heading</span>
              <span>{walk.heading_offset || 0}°</span>
            </div>
            <div className="info-row">
              <span className="info-label">Pitch</span>
              <span>{walk.pitch || 0}°</span>
            </div>
            <div className="info-row">
              <span className="info-label">FOV (Zoom)</span>
              <span>{walk.fov || 90}°</span>
            </div>
            <div className="info-row">
              <span className="info-label">Format</span>
              <span>{walk.aspect_ratio || '1:1'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Created</span>
              <span>{new Date(walk.created_at).toLocaleString()}</span>
            </div>

            {isProcessing && (
              <div className="processing-section">
                <p>Processing... {progress}%</p>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <p className="frame-count">
                  {walk.downloaded_frames} / {walk.total_frames} frames
                </p>
              </div>
            )}

            {isError && (
              <div className="error-section">
                <p>Error: {walk.error_message}</p>
              </div>
            )}

            {rateLimitError && (
              <div className="error-section">
                <p>{rateLimitError}</p>
              </div>
            )}

            <div className="detail-actions">
              {(walk.status === 'draft' || walk.status === 'error') && walk.points?.length >= 2 && (
                <button className="btn-primary" onClick={handleGenerateClick}>
                  Generate Video
                </button>
              )}
              {isDone && (
                <>
                  <button className="btn-primary" onClick={handleGenerateClick}>
                    Regenerate
                  </button>
                  <button className="btn-danger btn-small" onClick={handleDeleteVideo}>
                    Delete Video
                  </button>
                </>
              )}
              {isProcessing && (
                <button className="btn-secondary" onClick={handleReprocess}>
                  Reprocess
                </button>
              )}
              {isError && walk.points?.length >= 2 && (
                <button className="btn-secondary" onClick={handleReprocess}>
                  Reprocess
                </button>
              )}
              {!isProcessing && (
                <button className="btn-secondary" onClick={() => setShowLogs((v) => !v)}>
                  {showLogs ? 'Hide Logs' : 'Show Logs'}
                </button>
              )}
            </div>
          </div>

          {showEstimate && (
            <div className="info-card">
              <CostEstimate
                points={walk.points}
                walkId={id}
                onConfirm={handleGenerateConfirm}
                onCancel={() => setShowEstimate(false)}
              />
            </div>
          )}

          <LogWindow walkId={id} visible={showLogs} />

          {isDone && (
            <div className="info-card video-card">
              <h3>Video</h3>
              <video controls src={`/api/walks/${id}/video`} className="detail-video" />
              <a
                href={`/api/walks/${id}/video`}
                download={`${walk.name}.mp4`}
                className="btn-secondary download-btn"
              >
                Download Video
              </a>
            </div>
          )}
        </div>

        <div className="detail-map">
          <MapEditor points={walk.points || []} onMapClick={() => {}} readonly />
        </div>
      </div>
    </div>
  );
}
