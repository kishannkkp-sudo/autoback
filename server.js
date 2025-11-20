// server.js - FirstJobly Backend v6 (FINAL & BULLETPROOF)
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cors({
  origin: ['http://localhost:5173', 'https://www.firstjobly.in', 'http://localhost:3000', 'https://firstjobly.in'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// TiDB Cloud Config
const dbConfig = {
  host: process.env.DB_HOST || 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
  port: process.env.DB_PORT || 4000,
  user: process.env.DB_USER || '2hHpQFMDsuaTdbF.root',
  password: process.env.DB_PASSWORD || 'Rb9LMJstTQffMdRu',
  database: process.env.DB_NAME || 'test',
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
  connectionLimit: 15,
  waitForConnections: true,
  queueLimit: 0
};

let pool = null;
let isMySQL = false;  // Critical flag to detect which DB is active

// Connect to TiDB Cloud → Fallback to SQLite only if fails
async function connectToDatabase() {
  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('SUCCESS: Connected to TiDB Cloud MySQL');
    isMySQL = true;
    connection.release();
  } catch (err) {
    console.warn('TiDB Cloud connection failed → switching to local SQLite fallback');
    console.warn('Make sure your IP is whitelisted in TiDB Cloud Dashboard!');
    
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
    console.log('SQLite fallback database ready at ./jobs_local.db');
  }
}

// Initialize MySQL table with proper indexes
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
    console.log('MySQL table initialized with fast indexes');
  } catch (err) {
    console.error('Failed to create MySQL table:', err.message);
  }
}

// POST - Save new job (prevents duplicates)
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

// GET - Paginated Jobs (24 per page) — WORKS FOR BOTH MySQL & SQLite
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
          err ? reject(err) : resolve(row.total);
        });
      });
    }

    // Parse skills
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
    status: "FirstJobly Backend v6 – 100% WORKING",
    database: isMySQL ? "TiDB Cloud MySQL (Production)" : "Local SQLite (Fallback)",
    time: new Date().toISOString(),
    jobs_per_page: 24,
    endpoints: {
      "GET /posts?page=1": "24 latest jobs",
      "GET /posts/123": "Single job",
      "POST /posts": "Add new job"
    },
    tip: "Your site is now blazing fast with pagination!"
  });
});

// Start Server
(async () => {
  await connectToDatabase();
  if (isMySQL) {
    await initializeMySQLTable();
  }

  app.listen(port, () => {
    console.log('=====================================');
    console.log(`SERVER RUNNING → http://localhost:${port}`);
    console.log(`Database: ${isMySQL ? 'TiDB Cloud MySQL' : 'Local SQLite Fallback'}`);
    console.log(`24 Jobs per page | Lightning Fast`);
    console.log('=====================================');
  });
})();