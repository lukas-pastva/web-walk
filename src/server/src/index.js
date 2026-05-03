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
for (const dir of ['frames', 'videos']) {
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
  const { name, duration_seconds, heading_offset, pitch, fov, points } = req.body;
  if (!points || points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }

  const id = uuidv4();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO walks (id, name, duration_seconds, heading_offset, pitch, fov, status)
       VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
      [id, name || 'Untitled Walk', duration_seconds || 60, heading_offset || 0, pitch || 0, fov || 90]
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
    if (walk.status !== 'draft') {
      return res.status(400).json({ error: 'Can only edit draft walks' });
    }

    const { name, duration_seconds, heading_offset, pitch, fov, points } = req.body;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE walks SET name = ?, duration_seconds = ?, heading_offset = ?, pitch = ?, fov = ?,
         updated_at = NOW() WHERE id = ?`,
        [
          name || walk.name,
          duration_seconds || walk.duration_seconds,
          heading_offset ?? walk.heading_offset ?? 0,
          pitch ?? walk.pitch ?? 0,
          fov ?? walk.fov ?? 90,
          req.params.id,
        ]
      );
      if (points) {
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
const DAILY_REQUEST_LIMIT = parseInt(process.env.DAILY_API_LIMIT) || 5000;

// Generate video for a walk
app.post('/api/walks/:id/generate', async (req, res) => {
  try {
    const [usage] = await pool.query(
      `SELECT COALESCE(SUM(request_count), 0) as total_requests
       FROM api_usage WHERE created_at >= NOW() - INTERVAL 24 HOUR`
    );
    if (usage[0].total_requests >= DAILY_REQUEST_LIMIT) {
      return res.status(429).json({
        error: 'Daily API limit reached',
        message: `Limit ${DAILY_REQUEST_LIMIT} requests per 24 hours exceeded (${usage[0].total_requests} used). Try again later.`,
        requests_used: usage[0].total_requests,
        limit: DAILY_REQUEST_LIMIT,
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
        used: last24h[0].total_requests,
        limit: DAILY_REQUEST_LIMIT,
        remaining: Math.max(0, DAILY_REQUEST_LIMIT - last24h[0].total_requests),
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
