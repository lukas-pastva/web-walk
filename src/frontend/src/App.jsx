import React, { useState, useEffect, useCallback } from 'react';
import MapView from './components/MapView';
import ControlPanel from './components/ControlPanel';
import VideoPlayer from './components/VideoPlayer';

function App() {
  const [pointA, setPointA] = useState(null);
  const [pointB, setPointB] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleMapClick = useCallback((latlng) => {
    if (!pointA) {
      setPointA(latlng);
    } else if (!pointB) {
      setPointB(latlng);
    }
  }, [pointA, pointB]);

  const handleClear = () => {
    setPointA(null);
    setPointB(null);
    setJob(null);
  };

  const handleGenerate = async () => {
    if (!pointA || !pointB) return;
    setLoading(true);
    try {
      const resp = await fetch('/api/walks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startLat: pointA.lat,
          startLng: pointA.lng,
          endLat: pointB.lat,
          endLng: pointB.lng,
        }),
      });
      const data = await resp.json();
      setJob({ id: data.id, status: 'pending', totalFrames: 0, downloadedFrames: 0 });
    } catch (err) {
      console.error('Failed to create walk:', err);
    }
    setLoading(false);
  };

  // Poll job status
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/walks/${job.id}`);
        const data = await resp.json();
        setJob(data);
      } catch (err) {
        console.error('Failed to poll job:', err);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [job]);

  return (
    <div className="app">
      <MapView pointA={pointA} pointB={pointB} onMapClick={handleMapClick} />
      <ControlPanel
        pointA={pointA}
        pointB={pointB}
        job={job}
        loading={loading}
        onGenerate={handleGenerate}
        onClear={handleClear}
      />
      {job && job.status === 'done' && <VideoPlayer jobId={job.id} />}
    </div>
  );
}

export default App;
