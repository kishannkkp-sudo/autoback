// server.js - FirstJobly Backend v10 FINAL (Local + Vercel Ready)
require('dotenv').config();        // ← This line reads .env automatically
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://www.firstjobly.in', 'https://firstjobly.in'],
}));

// ====================== DATABASE ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 20,
});

async function initializeDatabase() {
  try {
    console.log('Connecting to database...');
    await pool.query('SELECT 1');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(1000) NOT NULL,
        description TEXT NOT NULL,
        company_name VARCHAR(255),
        company_logo VARCHAR(500),
        job_req_id VARCHAR(200) UNIQUE,
        apply_link TEXT,
        location TEXT,
        experience VARCHAR(200),
        skills JSONB DEFAULT '[]',
        remote_type VARCHAR(100),
        time_type VARCHAR(100),
        posted_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_created_at ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_req ON posts(job_req_id);
    `);

    console.log('Database connected & ready!');
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
}

// ====================== ROUTES ======================
app.get('/', (req, res) => {
  res.json({
    status: "FirstJobly Backend v10 – LIVE",
    database: "Neon PostgreSQL",
    local: !!process.env.DOTENV_CONFIG_PATH,
    time: new Date().toISOString(),
  });
});

app.post('/posts', async (req, res) => {
  const { title, description, company_name, company_logo, job_req_id, apply_link, location, experience, skills, remote_type, time_type, posted_date } = req.body;

  if (!title || !description) return res.status(400).json({ error: 'Title & description required' });

  try {
    await pool.query(`
      INSERT INTO posts (title, description, company_name, company_logo, job_req_id, apply_link, location, experience, skills, remote_type, time_type, posted_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (job_req_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        apply_link = EXCLUDED.apply_link,
        company_logo = EXCLUDED.company_logo
    `, [title, description, company_name || null, company_logo || null, job_req_id || null, apply_link || null, location || null, experience || null, skills || [], remote_type || null, time_type || null, posted_date || null]);

    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Save failed' });
  }
});

app.get('/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 24;
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    const { rows: count } = await pool.query('SELECT COUNT(*) FROM posts');
    const total = parseInt(count[0].count);

    res.json({
      jobs: rows,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalJobs: total, hasNext: page < Math.ceil(total / limit), hasPrev: page > 1 }
    });
  } catch (err) {
    res.status(500).json({ error: 'Load failed' });
  }
});

app.get('/posts/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
});

// ====================== START ======================
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log('=====================================');
    console.log('FIRSTJOBLY BACKEND v10 RUNNING');
    console.log(`http://localhost:${port}`);
    console.log('Database → Neon PostgreSQL');
    console.log('Ready for Vercel deploy!');
    console.log('=====================================');
  });
});
