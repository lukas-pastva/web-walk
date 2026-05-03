const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { pool, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/data';
const PYTHON_PATH = process.env.PYTHON_PATH || '/app/venv/bin/python';
const WALKER_SCRIPT = path.join(__dirname, '../../walker/walker.py');

app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Ensure directories exist
for (const dir of ['frames', 'videos', 'cache/streetview']) {
  fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Walks CRUD ---

// List all walks
app.get('/api/walks', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM walks ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single walk with points
app.get('/api/walks/:id', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });
    const walk = walks[0];
    const [points] = await pool.query(
      'SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order', [walk.id]
    );
    walk.points = points;
    res.json(walk);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create walk
app.post('/api/walks', async (req, res) => {
  const { name, duration_seconds, heading_offset, pitch, fov, aspect_ratio, points } = req.body;
  if (!points || points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }

  const id = uuidv4();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO walks (id, name, duration_seconds, heading_offset, pitch, fov, aspect_ratio, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [id, name || 'Untitled Walk', duration_seconds || 60, heading_offset || 0, pitch || 0, fov || 90, aspect_ratio || '1:1']
    );
    for (let i = 0; i < points.length; i++) {
      await conn.query(
        'INSERT INTO walk_points (walk_id, sort_order, lat, lng) VALUES (?, ?, ?, ?)',
        [id, i, points[i].lat, points[i].lng]
      );
    }
    await conn.commit();

    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [id]);
    const [pts] = await pool.query('SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order', [id]);
    walks[0].points = pts;
    res.status(201).json(walks[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Update walk
app.put('/api/walks/:id', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });
    const walk = walks[0];
    const isDraft = walk.status === 'draft';

    const { name, duration_seconds, heading_offset, pitch, fov, aspect_ratio, points } = req.body;

    // Non-draft walks: only allow name, duration, aspect_ratio changes
    if (!isDraft && (points || heading_offset !== undefined || pitch !== undefined || fov !== undefined)) {
      // Check if route/camera params actually changed
      const routeChanged = !!points;
      const cameraChanged = (heading_offset !== undefined && heading_offset !== walk.heading_offset) ||
                            (pitch !== undefined && pitch !== walk.pitch) ||
                            (fov !== undefined && fov !== walk.fov);
      if (routeChanged || cameraChanged) {
        return res.status(400).json({ error: 'Route and camera settings can only be changed on draft walks. Use Reprocess first.' });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE walks SET name = ?, duration_seconds = ?, heading_offset = ?, pitch = ?, fov = ?, aspect_ratio = ?,
         updated_at = NOW() WHERE id = ?`,
        [
          name || walk.name,
          duration_seconds || walk.duration_seconds,
          heading_offset ?? walk.heading_offset ?? 0,
          pitch ?? walk.pitch ?? 0,
          fov ?? walk.fov ?? 90,
          aspect_ratio || walk.aspect_ratio || '1:1',
          req.params.id,
        ]
      );
      if (points && isDraft) {
        await conn.query('DELETE FROM walk_points WHERE walk_id = ?', [req.params.id]);
        for (let i = 0; i < points.length; i++) {
          await conn.query(
            'INSERT INTO walk_points (walk_id, sort_order, lat, lng) VALUES (?, ?, ?, ?)',
            [req.params.id, i, points[i].lat, points[i].lng]
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    const [updated] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    const [pts] = await pool.query('SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order', [req.params.id]);
    updated[0].points = pts;
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete walk
app.delete('/api/walks/:id', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });

    await pool.query('DELETE FROM walks WHERE id = ?', [req.params.id]);

    // Cleanup files
    const framesDir = path.join(OUTPUT_DIR, 'frames', req.params.id);
    const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete video only (keep walk)
app.delete('/api/walks/:id/video', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });

    const framesDir = path.join(OUTPUT_DIR, 'frames', req.params.id);
    const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    await pool.query(
      `UPDATE walks SET status = 'draft', total_frames = 0, downloaded_frames = 0,
       error_message = NULL, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reprocess (force reset status so generate works again)
app.post('/api/walks/:id/reprocess', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });

    // Clean up old files
    const framesDir = path.join(OUTPUT_DIR, 'frames', req.params.id);
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });

    await pool.query(
      `UPDATE walks SET status = 'draft', total_frames = 0, downloaded_frames = 0,
       error_message = NULL, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    res.json({ ok: true, status: 'reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gallery - list walks that have videos
app.get('/api/gallery', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, duration_seconds, created_at FROM walks WHERE status = 'done' ORDER BY updated_at DESC"
    );
    // Filter to only those with actual video files
    const gallery = rows.filter((w) =>
      fs.existsSync(path.join(OUTPUT_DIR, 'videos', `${w.id}.mp4`))
    );
    res.json(gallery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily API request limit
const DAILY_COST_LIMIT = parseFloat(process.env.DAILY_COST_LIMIT) || 50;

// Generate video for a walk
app.post('/api/walks/:id/generate', async (req, res) => {
  try {
    const [usage] = await pool.query(
      `SELECT COALESCE(SUM(request_count), 0) as total_requests,
              COALESCE(SUM(cost_usd), 0) as total_cost
       FROM api_usage WHERE created_at >= NOW() - INTERVAL 24 HOUR`
    );
    if (usage[0].total_cost >= DAILY_COST_LIMIT) {
      return res.status(429).json({
        error: 'Daily cost limit reached',
        message: `Daily limit of $${DAILY_COST_LIMIT} exceeded ($${usage[0].total_cost.toFixed(2)} used). Try again later.`,
        cost_used: usage[0].total_cost,
        limit: DAILY_COST_LIMIT,
      });
    }

    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });

    const [points] = await pool.query(
      'SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order', [req.params.id]
    );
    if (points.length < 2) {
      return res.status(400).json({ error: 'At least 2 points required' });
    }

    await pool.query(
      `UPDATE walks SET status = 'pending', total_frames = 0, downloaded_frames = 0,
       error_message = NULL, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    // Clear old logs for this walk
    await pool.query('DELETE FROM walk_logs WHERE walk_id = ?', [req.params.id]);

    // Spawn walker process
    const child = spawn(PYTHON_PATH, [WALKER_SCRIPT, req.params.id], {
      env: {
        ...process.env,
        OUTPUT_DIR,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
        GOOGLE_SIGNING_SECRET: process.env.GOOGLE_SIGNING_SECRET || '',
        DB_HOST: process.env.DB_HOST || 'localhost',
        DB_USER: process.env.DB_USER || 'root',
        DB_PASSWORD: process.env.DB_PASSWORD || '',
        DB_NAME: process.env.DB_NAME || 'web_walk',
        DB_PORT: process.env.DB_PORT || '3306',
      },
      stdio: 'pipe',
    });

    child.stdout.on('data', (d) => console.log(`[walker:${req.params.id}] ${d.toString().trim()}`));
    child.stderr.on('data', (d) => console.error(`[walker:${req.params.id}] ${d.toString().trim()}`));
    child.on('close', (code) => console.log(`[walker:${req.params.id}] exited with code ${code}`));

    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream video
app.get('/api/walks/:id/video', (req, res) => {
  const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.sendFile(videoPath);
});

// --- API Usage ---

app.get('/api/usage', async (req, res) => {
  try {
    const [summary] = await pool.query(`
      SELECT api_type, SUM(request_count) as total_requests, SUM(cost_usd) as total_cost,
             MIN(created_at) as first_used, MAX(created_at) as last_used
      FROM api_usage GROUP BY api_type
    `);
    const [byMonth] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month, api_type,
             SUM(request_count) as total_requests, SUM(cost_usd) as total_cost
      FROM api_usage GROUP BY month, api_type ORDER BY month DESC
    `);
    const [total] = await pool.query(
      'SELECT SUM(request_count) as total_requests, SUM(cost_usd) as total_cost FROM api_usage'
    );
    const [last24h] = await pool.query(
      `SELECT COALESCE(SUM(request_count), 0) as total_requests, COALESCE(SUM(cost_usd), 0) as total_cost
       FROM api_usage WHERE created_at >= NOW() - INTERVAL 24 HOUR`
    );
    res.json({
      summary,
      byMonth,
      total: total[0],
      rateLimit: {
        costUsed: last24h[0].total_cost,
        costLimit: DAILY_COST_LIMIT,
        costRemaining: Math.max(0, DAILY_COST_LIMIT - last24h[0].total_cost),
        requestsUsed: last24h[0].total_requests,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Walk Logs ---

app.get('/api/walks/:id/logs', async (req, res) => {
  try {
    const since = req.query.since || '1970-01-01';
    const [rows] = await pool.query(
      'SELECT * FROM walk_logs WHERE walk_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 500',
      [req.params.id, since]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings ---

app.get('/api/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT `key`, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, value] of entries) {
        await conn.query(
          'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = NOW()',
          [key, String(value), String(value)]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    const [rows] = await pool.query('SELECT `key`, value FROM settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Cache stats ---

app.get('/api/cache/stats', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) as total_images, COALESCE(SUM(file_size), 0) as total_bytes FROM streetview_cache'
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estimate cache hits for a walk before generating
app.get('/api/walks/:id/estimate-cache', async (req, res) => {
  try {
    const [walks] = await pool.query('SELECT * FROM walks WHERE id = ?', [req.params.id]);
    if (!walks.length) return res.status(404).json({ error: 'Walk not found' });
    const walk = walks[0];

    const [points] = await pool.query(
      'SELECT * FROM walk_points WHERE walk_id = ? ORDER BY sort_order', [req.params.id]
    );
    if (points.length < 2) return res.json({ estFrames: 0, cachedFrames: 0, newFrames: 0 });

    const pitch = Math.round(walk.pitch || 0);
    const fov = Math.round(walk.fov || 90);
    const headingOffset = walk.heading_offset || 0;
    const aspectRatio = walk.aspect_ratio || '1:1';

    // Determine image size based on aspect ratio (same logic as walker)
    const SIGNING = !!(process.env.GOOGLE_SIGNING_SECRET);
    const ASPECT_SIZES = {
      '1:1': SIGNING ? '2048x2048' : '640x640',
      '3:2': SIGNING ? '2048x1365' : '640x427',
      '4:3': SIGNING ? '2048x1536' : '640x480',
      '16:9': SIGNING ? '2048x1152' : '640x360',
    };
    const size = ASPECT_SIZES[aspectRatio] || ASPECT_SIZES['1:1'];

    // Estimate route: straight-line * 1.4 factor, points every 15m
    const toRad = (d) => (d * Math.PI) / 180;
    const haversine = (lat1, lng1, lat2, lng2) => {
      const R = 6371000;
      const dp = toRad(lat2 - lat1);
      const dl = toRad(lng2 - lng1);
      const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const bearing = (lat1, lng1, lat2, lng2) => {
      const dl = toRad(lng2 - lng1);
      const x = Math.sin(dl) * Math.cos(toRad(lat2));
      const y = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dl);
      return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
    };

    // Generate estimated points along straight-line segments
    const estPoints = [];
    for (let i = 0; i < points.length - 1; i++) {
      const d = haversine(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) * 1.4;
      const numPts = Math.ceil(d / 15);
      for (let j = 0; j <= numPts; j++) {
        const frac = numPts > 0 ? j / numPts : 0;
        const lat = points[i].lat + frac * (points[i + 1].lat - points[i].lat);
        const lng = points[i].lng + frac * (points[i + 1].lng - points[i].lng);
        const hdg = Math.round((bearing(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng) + headingOffset + 360) % 360);
        estPoints.push({ lat: parseFloat(lat.toFixed(5)), lng: parseFloat(lng.toFixed(5)), hdg });
      }
    }

    // Check cache for each estimated point
    let cachedFrames = 0;
    if (estPoints.length > 0) {
      // Batch check: query all cache entries matching our params
      const [cached] = await pool.query(
        'SELECT lat_key, lng_key, heading_key FROM streetview_cache WHERE pitch = ? AND fov = ? AND size = ?',
        [pitch, fov, size]
      );
      const cacheSet = new Set(cached.map(r => `${r.lat_key}_${r.lng_key}_${r.heading_key}`));
      for (const p of estPoints) {
        if (cacheSet.has(`${p.lat}_${p.lng}_${p.hdg}`)) {
          cachedFrames++;
        }
      }
    }

    const estFrames = estPoints.length;
    const newFrames = estFrames - cachedFrames;
    const savedCost = cachedFrames * 0.007;

    res.json({ estFrames, cachedFrames, newFrames, savedCost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// Start server after DB init
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Web Walk server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
