const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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
for (const dir of ['jobs', 'frames', 'videos']) {
  fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Create a new walk job
app.post('/api/walks', (req, res) => {
  const { startLat, startLng, endLat, endLng } = req.body;

  if (!startLat || !startLng || !endLat || !endLng) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }

  const id = uuidv4();
  const job = {
    id,
    status: 'pending',
    startLat: parseFloat(startLat),
    startLng: parseFloat(startLng),
    endLat: parseFloat(endLat),
    endLng: parseFloat(endLng),
    totalFrames: 0,
    downloadedFrames: 0,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const jobPath = path.join(OUTPUT_DIR, 'jobs', `${id}.json`);
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));

  // Spawn walker process
  const child = spawn(PYTHON_PATH, [WALKER_SCRIPT, id], {
    env: {
      ...process.env,
      OUTPUT_DIR,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
    },
    stdio: 'pipe',
  });

  child.stdout.on('data', (d) => console.log(`[walker:${id}] ${d.toString().trim()}`));
  child.stderr.on('data', (d) => console.error(`[walker:${id}] ${d.toString().trim()}`));
  child.on('close', (code) => console.log(`[walker:${id}] exited with code ${code}`));

  res.status(201).json({ id });
});

// Get job status
app.get('/api/walks/:id', (req, res) => {
  const jobPath = path.join(OUTPUT_DIR, 'jobs', `${req.params.id}.json`);
  if (!fs.existsSync(jobPath)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  res.json(job);
});

// Stream video
app.get('/api/walks/:id/video', (req, res) => {
  const videoPath = path.join(OUTPUT_DIR, 'videos', `${req.params.id}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.sendFile(videoPath);
});

// List all walks
app.get('/api/walks', (req, res) => {
  const jobsDir = path.join(OUTPUT_DIR, 'jobs');
  const files = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'));
  const jobs = files
    .map(f => JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8')))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobs);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Web Walk server running on port ${PORT}`);
});
