// server.js - FirstJobly Backend v12.5 — FORCED JSON SERIALIZATION
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://www.firstjobly.in', 'https://firstjobly.in'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is missing in .env file!');
  process.exit(1);
}

// Initialize Database Tables
async function initDB() {
  try {
    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(1000) NOT NULL,
        description TEXT NOT NULL,
        company_name VARCHAR(255),
        company_logo VARCHAR(500),
        job_req_id VARCHAR(500) UNIQUE,
        apply_link TEXT,
        location TEXT,
        experience VARCHAR(200),
        skills JSONB DEFAULT '[]'::jsonb,
        remote_type VARCHAR(100),
        time_type VARCHAR(100),
        posted_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_created_at ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_req ON posts(job_req_id);
      CREATE INDEX IF NOT EXISTS idx_skills ON posts USING GIN (skills);
    `);
    console.log('✅ Database connected and tables are ready.');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  }
}

// --- API ROUTES ---

// POST /posts
app.post('/posts', async (req, res) => {
  // *** DEBUGGING: Log the raw body to see what Python is sending ***
  console.log('--- INCOMING REQUEST BODY ---');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('--- END INCOMING BODY ---');

  let { title, description, company_name, company_logo, job_req_id, apply_link, location, experience, skills, remote_type, time_type, posted_date } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'title and description are required' });
  }

  // Initial skills handling
  if (typeof skills === 'string') {
    try { skills = JSON.parse(skills); } 
    catch { skills = skills.split(',').map(s => s.trim()).filter(Boolean); }
  }
  if (!Array.isArray(skills)) skills = [];
  
  // *** THE FINAL, DEFINITIVE FIX ***
  // 1. Clean the array to remove any non-string or empty elements.
  const cleanSkills = skills
    .filter(s => s && typeof s === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // 2. Forcefully serialize the array into a JSON string.
  // This ensures PostgreSQL receives a perfectly formatted JSON string,
  // bypassing any potential issues with the `pg` library's automatic serialization.
  const skillsJsonString = JSON.stringify(cleanSkills);

  try {
    // 3. Pass the JSON STRING to the query, not the array.
    await pool.query(`
      INSERT INTO posts (title, description, company_name, company_logo, job_req_id, apply_link, location, experience, skills, remote_type, time_type, posted_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      ON CONFLICT (job_req_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        apply_link = EXCLUDED.apply_link,
        company_logo = EXCLUDED.company_logo,
        skills = EXCLUDED.skills
    `, [title, description, company_name, company_logo, job_req_id, apply_link, location, experience, skillsJsonString, remote_type, time_type, posted_date || null]);

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('INSERT FAILED:', err.message);
    console.error('--- PROBLEMATIC DATA DUMP ---');
    console.error('Title:', title);
    console.error('Skills Array Before Stringify:', skills);
    console.error('Skills JSON String:', skillsJsonString);
    console.error('--- END DATA DUMP ---');
    
    res.status(500).json({ error: 'Failed to save post.', details: err.message });
  }
});

// GET /posts
app.get('/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 24;
  const offset = (page - 1) * limit;

  try {
    const { rows } = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM posts');
    const total = parseInt(count);

    res.json({
      jobs: rows,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalJobs: total }
    });
  } catch (err) {
    console.error('GET posts error:', err.message);
    res.status(500).json({ error: 'Failed to load posts.' });
  }
});

// GET /posts/:id
app.get('/posts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Post not found' });
    }
  } catch (err) {
    console.error('GET post by ID error:', err.message);
    res.status(500).json({ error: 'Failed to load post.' });
  }
});

// Health Check
app.get('/', (req, res) => {
  res.json({ status: "FirstJobly v12.5 — FORCED SERIALIZATION", time: new Date().toISOString() });
});

// --- START SERVER ---
const startServer = async () => {
  await initDB();
  app.listen(port, () => {
    console.log('=====================================');
    console.log('🚀 FIRSTJOBLY BACKEND IS RUNNING!');
    console.log(`📍 http://localhost:${port}`);
    console.log('=====================================');
  });
};

startServer();
