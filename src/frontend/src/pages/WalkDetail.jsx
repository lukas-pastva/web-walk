import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MapEditor from '../components/MapEditor';

function LogWindow({ walkId, visible }) {
  const [logs, setLogs] = useState([]);
  const bottomRef = useRef(null);
  const sinceRef = useRef('1970-01-01');

  useEffect(() => {
    if (!visible) return;
    const fetchLogs = async () => {
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Reset when walk restarts
  useEffect(() => {
    if (visible) {
      setLogs([]);
      sinceRef.current = '1970-01-01';
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="info-card log-card">
      <h3>Processing Log</h3>
      <div className="log-window">
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
        <div ref={bottomRef} />
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

  const handleGenerate = async () => {
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
    handleGenerate();
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
                <button className="btn-primary" onClick={handleGenerate}>
                  Generate Video
                </button>
              )}
              {isDone && (
                <>
                  <button className="btn-primary" onClick={handleGenerate}>
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
