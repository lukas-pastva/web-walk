import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  error: 'Error',
};

const STATUS_COLORS = {
  draft: '#888',
  pending: '#e6a23c',
  processing: '#4a90d9',
  done: '#67c23a',
  error: '#f56c6c',
};

export default function WalkList() {
  const [walks, setWalks] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchWalks = async () => {
    try {
      const resp = await fetch('/api/walks');
      setWalks(await resp.json());
    } catch (err) {
      console.error('Failed to fetch walks:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWalks();
    const interval = setInterval(fetchWalks, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this walk?')) return;
    await fetch(`/api/walks/${id}`, { method: 'DELETE' });
    fetchWalks();
  };

  if (loading) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>My Walks</h2>
        <button className="btn-primary" onClick={() => navigate('/new')}>+ New Walk</button>
      </div>

      {walks.length === 0 ? (
        <div className="empty-state">
          <p>No walks yet.</p>
          <p>Create your first walk to generate a Street View video.</p>
        </div>
      ) : (
        <div className="walk-grid">
          {walks.map((walk) => (
            <div
              key={walk.id}
              className="walk-card"
              onClick={() => navigate(`/walk/${walk.id}`)}
            >
              <div className="walk-card-header">
                <h3>{walk.name}</h3>
                <span className="status-badge" style={{ background: STATUS_COLORS[walk.status] }}>
                  {STATUS_LABELS[walk.status]}
                </span>
              </div>
              <div className="walk-card-meta">
                <span>Duration: {walk.duration_seconds}s</span>
                <span>{new Date(walk.created_at).toLocaleDateString()}</span>
              </div>
              {walk.status === 'processing' && walk.total_frames > 0 && (
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round((walk.downloaded_frames / walk.total_frames) * 100)}%` }}
                  />
                </div>
              )}
              <div className="walk-card-actions">
                <button className="btn-small btn-danger" onClick={(e) => handleDelete(e, walk.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
