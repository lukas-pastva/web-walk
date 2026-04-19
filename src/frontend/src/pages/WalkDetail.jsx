import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MapEditor from '../components/MapEditor';

export default function WalkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [walk, setWalk] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const handleGenerate = async () => {
    await fetch(`/api/walks/${id}/generate`, { method: 'POST' });
    fetchWalk();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this walk?')) return;
    await fetch(`/api/walks/${id}`, { method: 'DELETE' });
    navigate('/');
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
                </>
              )}
            </div>
          </div>

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
