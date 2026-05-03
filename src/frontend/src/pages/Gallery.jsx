import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Gallery() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/gallery')
      .then((r) => r.json())
      .then((data) => { setVideos(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  return (
    <div className="page gallery-page">
      <div className="page-header">
        <h2>Gallery</h2>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state">
          <p>No videos yet.</p>
          <p>Generate a walk video to see it here.</p>
        </div>
      ) : (
        <div className="gallery-grid">
          {videos.map((v) => (
            <div key={v.id} className="gallery-card" onClick={() => navigate(`/walk/${v.id}`)}>
              <video
                src={`/api/walks/${v.id}/video`}
                className="gallery-video"
                muted
                loop
                onMouseEnter={(e) => e.currentTarget.play()}
                onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
              />
              <div className="gallery-info">
                <h3>{v.name}</h3>
                <span className="gallery-meta">{v.duration_seconds}s</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
