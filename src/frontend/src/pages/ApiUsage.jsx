import React, { useState, useEffect } from 'react';

export default function ApiUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/usage')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="page"><p className="loading-text">Loading...</p></div>;
  }

  if (!data) {
    return <div className="page"><p>Failed to load usage data.</p></div>;
  }

  const totalRequests = data.total?.total_requests || 0;
  const totalCost = data.total?.total_cost || 0;

  return (
    <div className="page usage-page">
      <div className="page-header">
        <h2>API Usage</h2>
      </div>

      <div className="usage-summary">
        <div className="info-card">
          <h3>Daily Cost Limit (24h)</h3>
          {data.rateLimit && (
            <>
              <div className="usage-total">
                <div className="usage-stat">
                  <span className="usage-number">${(data.rateLimit.costUsed || 0).toFixed(2)}</span>
                  <span className="usage-label">Spent (24h)</span>
                </div>
                <div className="usage-stat">
                  <span className="usage-number">${(data.rateLimit.costRemaining || 0).toFixed(2)}</span>
                  <span className="usage-label">Remaining</span>
                </div>
                <div className="usage-stat">
                  <span className="usage-number">${(data.rateLimit.costLimit || 0).toFixed(0)}</span>
                  <span className="usage-label">Daily Limit</span>
                </div>
                <div className="usage-stat">
                  <span className="usage-number">{(data.rateLimit.requestsUsed || 0).toLocaleString()}</span>
                  <span className="usage-label">Requests (24h)</span>
                </div>
              </div>
              <div className="progress-bar" style={{ marginTop: 16 }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.min(100, ((data.rateLimit.costUsed || 0) / (data.rateLimit.costLimit || 50)) * 100)}%`,
                    background: (data.rateLimit.costRemaining || 0) <= 0 ? 'var(--danger)' : 'var(--accent)',
                  }}
                />
              </div>
              {(data.rateLimit.costRemaining || 0) <= 0 && (
                <p style={{ color: 'var(--danger)', marginTop: 12, fontSize: '0.9rem' }}>
                  Daily cost limit reached! Generation is blocked for 24 hours.
                </p>
              )}
            </>
          )}
        </div>

        <div className="info-card">
          <h3>Total</h3>
          <div className="usage-total">
            <div className="usage-stat">
              <span className="usage-number">{totalRequests.toLocaleString()}</span>
              <span className="usage-label">Total Requests</span>
            </div>
            <div className="usage-stat">
              <span className="usage-number">${totalCost.toFixed(4)}</span>
              <span className="usage-label">Estimated Cost</span>
            </div>
          </div>
        </div>

        <div className="info-card">
          <h3>By API Type</h3>
          <table className="usage-table">
            <thead>
              <tr>
                <th>API</th>
                <th>Requests</th>
                <th>Cost</th>
                <th>Price per 1000</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((row) => (
                <tr key={row.api_type}>
                  <td className="api-type-cell">
                    {row.api_type === 'directions' ? 'Directions API' : 'Street View Static API'}
                  </td>
                  <td>{row.total_requests.toLocaleString()}</td>
                  <td>${row.total_cost.toFixed(4)}</td>
                  <td>{row.api_type === 'directions' ? '$5.00' : '$7.00'}</td>
                  <td>{row.last_used ? new Date(row.last_used).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
              {data.summary.length === 0 && (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>No API calls yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="info-card">
          <h3>Monthly Breakdown</h3>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>API</th>
                <th>Requests</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.byMonth.map((row, i) => (
                <tr key={i}>
                  <td>{row.month}</td>
                  <td>{row.api_type === 'directions' ? 'Directions' : 'Street View'}</td>
                  <td>{row.total_requests.toLocaleString()}</td>
                  <td>${row.total_cost.toFixed(4)}</td>
                </tr>
              ))}
              {data.byMonth.length === 0 && (
                <tr><td colSpan="4" style={{ textAlign: 'center' }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="info-card">
          <h3>Pricing Reference</h3>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>
            Google Maps Platform pricing (Pay-as-you-go):
          </p>
          <table className="usage-table">
            <thead>
              <tr><th>API</th><th>Price per 1000 requests</th><th>Free tier</th></tr>
            </thead>
            <tbody>
              <tr><td>Directions API</td><td>$5.00</td><td>$200/month credit</td></tr>
              <tr><td>Street View Static API</td><td>$7.00</td><td>$200/month credit</td></tr>
            </tbody>
          </table>
          <p style={{ fontSize: 13, color: '#888', marginTop: 8 }}>
            Google provides $200 free credit per month. Costs shown are estimates.
          </p>
        </div>
      </div>
    </div>
  );
}
