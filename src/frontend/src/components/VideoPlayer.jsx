import React from 'react';

export default function VideoPlayer({ jobId }) {
  const videoUrl = `/api/walks/${jobId}/video`;

  return (
    <div className="video-overlay">
      <div className="video-container">
        <video controls autoPlay src={videoUrl} />
        <a href={videoUrl} download={`walk-${jobId}.mp4`} className="download-link">
          Download video
        </a>
      </div>
    </div>
  );
}
