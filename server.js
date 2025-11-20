// server.js - FirstJobly Backend v8 (CLEAN & SECURE - NO HARDCODED DB CREDENTIALS)
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// ====================== FIREBASE ADMIN SDK INITIALIZATION ======================
let firebaseApp = null;

try {
  let serviceAccount = null;

  // 1. Production: Use environment variable (Render, Railway, Vercel, etc.)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase: Loaded from FIREBASE_SERVICE_ACCOUNT env var');
  }
  // 2. Local dev: Use serviceAccountKey.json file
  else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('Firebase: Loaded from ./serviceAccountKey.json');
  }
  // 3. Fallback (only for quick testing - will warn)
  else {
    console.warn('Firebase key not found. Set FIREBASE_SERVICE_ACCOUNT or add serviceAccountKey.json');
  }

  if (serviceAccount) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://nodejs-d2e2f-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
    console.log('Firebase Admin SDK initialized successfully!');
  }
} catch (error) {
  console.error('Firebase init failed:', error.message);
}

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cors({
  origin: ['http://localhost:5173', 'https://www.firstjobly.in', 'http://localhost:3000', 'https://firstjobly.in'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ==================== DATABASE CONFIG - 100% ENVIRONMENT VARIABLES ONLY ====================
// NO MORE HARDCODED CREDENTIALS!
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'test',
  ssl: process.env.DB_HOST ? { rejectUnauthorized: true } : undefined,
  connectTimeout: 20000,
  connectionLimit: 15,
  waitForConnections: true,
  queueLimit: 0
};

let pool = null;
let isMySQL = false;

// Connect to Database (TiDB Cloud via env vars → fallback to SQLite)
async function connectToDatabase() {
  const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'];
  const missing = requiredEnv.filter(key => !process.env[key]);

  if (missing.length > 0 && !process.env.DB_HOST) {
    console.warn('No TiDB credentials found → switching to local SQLite fallback');
    useSQLiteFallback();
    return;
  }

  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('SUCCESS: Connected to TiDB Cloud (via environment variables)');
    isMySQL = true;
    connection.release();
  } catch (err) {
    console.error('TiDB connection failed:', err.message);
    console.warn('Falling back to local SQLite database...');
    useSQLiteFallback();
  }
}

function useSQLiteFallback() {
  const sqlite3 = require('sqlite3').verbose();
  pool = new sqlite3.Database('./jobs_local.db');
  isMySQL = false;

  pool.serialize(() => {
    pool.run(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        company_name TEXT,
        company_logo TEXT,
        job_req_id TEXT UNIQUE,
        apply_link TEXT,
        location TEXT,
        experience TEXT,
        skills TEXT,
        remote_type TEXT,
        time_type TEXT,
        posted_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    pool.run('CREATE INDEX IF NOT EXISTS idx_created_at ON posts(created_at DESC)');
    pool.run('CREATE INDEX IF NOT EXISTS idx_job_req ON posts(job_req_id)');
  });
  console.log('SQLite fallback database ready → ./jobs_local.db');
}

// Initialize MySQL table (only if using TiDB)
async function initializeMySQLTable() {
  if (!isMySQL) return;
  try {
    const conn = await pool.getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(1000) NOT NULL,
        description LONGTEXT NOT NULL,
        company_name VARCHAR(255),
        company_logo VARCHAR(500),
        job_req_id VARCHAR(200) UNIQUE,
        apply_link TEXT,
        location TEXT,
        experience VARCHAR(200),
        skills JSON,
        remote_type VARCHAR(100),
        time_type VARCHAR(100),
        posted_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created_at (created_at DESC),
        INDEX idx_job_req (job_req_id),
        INDEX idx_company (company_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    conn.release();
    console.log('MySQL table initialized with optimal indexes');
  } catch (err) {
    console.error('Failed to create MySQL table:', err.message);
  }
}

// POST - Save new job (duplicate-safe)
app.post('/posts', async (req, res) => {
  const {
    title, description, company_name, company_logo, job_req_id,
    apply_link, location, experience, skills, remote_type, time_type, posted_date
  } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }

  try {
    if (isMySQL) {
      const conn = await pool.getConnection();
      await conn.query(`
        INSERT INTO posts (
          title, description, company_name, company_logo, job_req_id,
          apply_link, location, experience, skills, remote_type, time_type, posted_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          description = VALUES(description),
          apply_link = VALUES(apply_link)
      `, [
        title, description, company_name, company_logo, job_req_id || null,
        apply_link, location, experience, JSON.stringify(skills || []),
        remote_type, time_type, posted_date || null
      ]);
      conn.release();
    } else {
      pool.run(`
        INSERT OR IGNORE INTO posts (
          title, description, company_name, company_logo, job_req_id,
          apply_link, location, experience, skills, remote_type, time_type, posted_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        title, description, company_name, company_logo, job_req_id || null,
        apply_link, location, experience, JSON.stringify(skills || []),
        remote_type, time_type, posted_date || null
      ]);
    }
    res.status(201).json({ success: true, message: 'Job saved successfully!' });
  } catch (err) {
    console.error('POST /posts error:', err.message);
    res.status(500).json({ error: 'Failed to save job' });
  }
});

// GET - Paginated Jobs (24 per page)
app.get('/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 24;
  const offset = (page - 1) * limit;

  try {
    let jobs = [];
    let total = 0;

    if (isMySQL) {
      const conn = await pool.getConnection();
      const [rows] = await conn.query(
        'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      const [[count]] = await conn.query('SELECT COUNT(*) as total FROM posts');
      jobs = rows;
      total = count.total;
      conn.release();
    } else {
      jobs = await new Promise((resolve, reject) => {
        pool.all(
          'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [limit, offset],
          (err, rows) => err ? reject(err) : resolve(rows || [])
        );
      });
      total = await new Promise((resolve, reject) => {
        pool.get('SELECT COUNT(*) as total FROM posts', (err, row) => {
          err ? reject(err) : resolve(row?.total || 0);
        });
      });
    }

    // Parse skills JSON
    jobs.forEach(job => {
      if (job.skills) {
        try {
          job.skills = typeof job.skills === 'string' ? JSON.parse(job.skills) : job.skills;
        } catch {
          job.skills = [];
        }
      } else {
        job.skills = [];
      }
    });

    res.json({
      jobs,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalJobs: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('GET /posts error:', err.message);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// GET - Single job by ID
app.get('/posts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let job = null;
    if (isMySQL) {
      const conn = await pool.getConnection();
      const [rows] = await conn.query('SELECT * FROM posts WHERE id = ?', [id]);
      conn.release();
      job = rows[0] || null;
    } else {
      job = await new Promise((resolve) => {
        pool.get('SELECT * FROM posts WHERE id = ?', [id], (err, row) => {
          resolve(row || null);
        });
      });
    }

    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.skills && typeof job.skills === 'string') {
      try { job.skills = JSON.parse(job.skills); } catch { job.skills = []; }
    }

    res.json(job);
  } catch (err) {
    console.error('GET /posts/:id error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: "FirstJobly Backend v8 – CLEAN & SECURE",
    database: isMySQL ? "TiDB Cloud (via env vars)" : "Local SQLite Fallback",
    firebase: firebaseApp ? "Active" : "Not initialized",
    time: new Date().toISOString(),
    jobs_per_page: 24,
    security: "No hardcoded credentials",
    tip: "Set DB_HOST, DB_USER, DB_PASSWORD + FIREBASE_SERVICE_ACCOUNT in your hosting dashboard!"
  });
});

// Start Server
(async () => {
  await connectToDatabase();
  if (isMySQL) await initializeMySQLTable();

  app.listen(port, () => {
    console.log('=====================================');
    console.log(`FIRSTJOBLY BACKEND v8 IS RUNNING`);
    console.log(`http://localhost:${port}`);
    console.log(`Database → ${isMySQL ? 'TiDB Cloud (Secure)' : 'SQLite (Local)'}`);
    console.log(`Firebase → ${firebaseApp ? 'Connected' : 'Not Connected'}`);
    console.log(`NO HARDCODED PASSWORDS ANYWHERE`);
    console.log('=====================================');
  });
})();