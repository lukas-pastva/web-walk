import React, { useState, useEffect } from 'react';

export default function CachedImages() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cache/images?page=${page}&limit=48`)
      .then((r) => r.json())
      .then((data) => {
        setImages(data.images);
        setTotalPages(data.pages);
        setTotal(data.total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page]);

  if (loading) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  return (
    <div className="page cached-images-page">
      <div className="page-header">
        <h2>Cached Images</h2>
        <span className="page-header-meta">{total} images</span>
      </div>

      {images.length === 0 ? (
        <div className="empty-state">
          <p>No cached images yet.</p>
          <p>Images are cached when you generate walk videos.</p>
        </div>
      ) : (
        <>
          <div className="cached-images-grid">
            {images.map((img) => (
              <div
                key={img.id}
                className="cached-image-card"
                onClick={() => setSelectedImage(img)}
              >
                <img
                  src={`/api/cache/images/${img.id}/file`}
                  alt={`${img.lat_key}, ${img.lng_key}`}
                  loading="lazy"
                  className="cached-image-thumb"
                />
                <div className="cached-image-info">
                  <span className="cached-image-coords">
                    {img.lat_key.toFixed(5)}, {img.lng_key.toFixed(5)}
                  </span>
                  <span className="cached-image-meta">
                    H:{img.heading_key} P:{img.pitch} F:{img.fov}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span className="pagination-info">
              Page {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}

      {selectedImage && (
        <div className="image-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <button className="image-modal-close" onClick={() => setSelectedImage(null)}>
              &times;
            </button>
            <img
              src={`/api/cache/images/${selectedImage.id}/file`}
              alt="Full size"
              className="image-modal-img"
            />
            <div className="image-modal-details">
              <p><strong>Location:</strong> {selectedImage.lat_key.toFixed(5)}, {selectedImage.lng_key.toFixed(5)}</p>
              <p><strong>Heading:</strong> {selectedImage.heading_key}&deg; | <strong>Pitch:</strong> {selectedImage.pitch}&deg; | <strong>FOV:</strong> {selectedImage.fov}&deg;</p>
              <p><strong>Size:</strong> {selectedImage.size} | <strong>File:</strong> {(selectedImage.file_size / 1024).toFixed(1)} KB</p>
              <p><strong>Cached:</strong> {new Date(selectedImage.created_at).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
