const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { db, stmts } = require('./db');

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
app.get('/api/walks', (req, res) => {
  const walks = stmts.listWalks.all();
  res.json(walks);
});

// Get single walk with points
app.get('/api/walks/:id', (req, res) => {
  const walk = stmts.getWalk.get(req.params.id);
  if (!walk) return res.status(404).json({ error: 'Walk not found' });
  walk.points = stmts.getPoints.all(walk.id);
  res.json(walk);
});

// Create walk
app.post('/api/walks', (req, res) => {
  const { name, duration_seconds, points } = req.body;
  if (!points || points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }

  const id = uuidv4();
  const saveWalk = db.transaction(() => {
    stmts.insertWalk.run({
      id,
      name: name || 'Untitled Walk',
      duration_seconds: duration_seconds || 60,
    });
    for (let i = 0; i < points.length; i++) {
      stmts.insertPoint.run({
        walk_id: id,
        sort_order: i,
        lat: points[i].lat,
        lng: points[i].lng,
      });
    }
  });
  saveWalk();

  const walk = stmts.getWalk.get(id);
  walk.points = stmts.getPoints.all(id);
  res.status(201).json(walk);
});

// Update walk
app.put('/api/walks/:id', (req, res) => {
  const walk = stmts.getWalk.get(req.params.id);
  if (!walk) return res.status(404).json({ error: 'Walk not found' });
  if (walk.status !== 'draft') {
    return res.status(400).json({ error: 'Can only edit draft walks' });
  }

  const { name, duration_seconds, points } = req.body;

  const updateWalk = db.transaction(() => {
    stmts.updateWalk.run({
      id: req.params.id,
      name: name || walk.name,
      duration_seconds: duration_seconds || walk.duration_seconds,
    });
    if (points) {
      stmts.deletePoints.run(req.params.id);
      for (let i = 0; i < points.length; i++) {
        stmts.insertPoint.run({
          walk_id: req.params.id,
          sort_order: i,
          lat: points[i].lat,
          lng: points[i].lng,
        });
      }
    }
  });
  updateWalk();

  const updated = stmts.getWalk.get(req.params.id);
  updated.points = stmts.getPoints.all(req.params.id);
  res.json(updated);
});

// Delete walk
app.delete('/api/walks/:id', (req, res) => {
  const walk = stmts.getWalk.get(req.params.id);
  if (!walk) return res.status(404).json({ error: 'Walk not found' });

  stmts.deleteWalk.run(req.params.id);

  // Cleanup files
  const framesDir = path.join(OUTPUT_DIR, 'frames', req.params.id);
  const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
  if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
  if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

  res.json({ ok: true });
});

// Generate video for a walk
app.post('/api/walks/:id/generate', (req, res) => {
  const walk = stmts.getWalk.get(req.params.id);
  if (!walk) return res.status(404).json({ error: 'Walk not found' });

  const points = stmts.getPoints.all(req.params.id);
  if (points.length < 2) {
    return res.status(400).json({ error: 'At least 2 points required' });
  }

  stmts.updateWalkStatus.run({
    id: req.params.id,
    status: 'pending',
    total_frames: 0,
    downloaded_frames: 0,
    error_message: null,
  });

  // Spawn walker process
  const child = spawn(PYTHON_PATH, [WALKER_SCRIPT, req.params.id], {
    env: {
      ...process.env,
      OUTPUT_DIR,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    },
    stdio: 'pipe',
  });

  child.stdout.on('data', (d) => console.log(`[walker:${req.params.id}] ${d.toString().trim()}`));
  child.stderr.on('data', (d) => console.error(`[walker:${req.params.id}] ${d.toString().trim()}`));
  child.on('close', (code) => console.log(`[walker:${req.params.id}] exited with code ${code}`));

  res.json({ status: 'started' });
});

// Stream video
app.get('/api/walks/:id/video', (req, res) => {
  const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.sendFile(videoPath);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Web Walk server running on port ${PORT}`);
});
