import React from 'react';

function formatCoord(point) {
  if (!point) return '-';
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

export default function ControlPanel({ pointA, pointB, job, loading, onGenerate, onClear }) {
  const isProcessing = job && (job.status === 'pending' || job.status === 'processing');
  const isDone = job && job.status === 'done';
  const isError = job && job.status === 'error';
  const progress = job && job.totalFrames > 0
    ? Math.round((job.downloadedFrames / job.totalFrames) * 100)
    : 0;

  let statusText = 'Click the map to set the start point';
  if (pointA && !pointB) statusText = 'Click the map to set the end point';
  if (pointA && pointB && !job) statusText = 'Ready to generate';
  if (isProcessing) statusText = `Processing... ${progress}%`;
  if (isDone) statusText = 'Done!';
  if (isError) statusText = `Error: ${job.errorMessage}`;

  return (
    <div className="control-panel">
      <h2>Web Walk</h2>
      <div className="coords">
        <div><strong>A:</strong> {formatCoord(pointA)}</div>
        <div><strong>B:</strong> {formatCoord(pointB)}</div>
      </div>
      <p className="status">{statusText}</p>
      {isProcessing && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="buttons">
        {pointA && pointB && !job && (
          <button onClick={onGenerate} disabled={loading}>
            {loading ? 'Starting...' : 'Generate Walk'}
          </button>
        )}
        <button onClick={onClear} className="btn-secondary">Clear</button>
      </div>
    </div>
  );
}
