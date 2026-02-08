#!/usr/bin/env node
/**
 * SUBSTRATE Backup HTTP API
 *
 * Provides HTTP control interface for backup operations.
 * Runs inside the backup container and exposes endpoints for:
 * - Health checks
 * - Manual backup triggers
 * - Restore operations
 * - Status queries
 */

const http = require('http');
const { execSync, spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.API_PORT || 8080;
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const DB_HOST = process.env.DB_HOST || 'postgres';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_NAME = process.env.DB_NAME || 'substrate';
const DB_USER = process.env.DB_USER || 'substrate';

// In-memory job status (synced with database)
const activeJobs = new Map();

/**
 * Execute PostgreSQL query
 */
function pgQuery(sql) {
  const env = {
    ...process.env,
    PGPASSWORD: process.env.POSTGRES_PASSWORD,
    PGHOST: DB_HOST,
    PGPORT: DB_PORT,
    PGDATABASE: DB_NAME,
    PGUSER: DB_USER
  };

  try {
    const result = execSync(`psql -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
      env,
      encoding: 'utf8',
      timeout: 30000
    });
    return result.trim();
  } catch (error) {
    console.error('Database query failed:', error.message);
    return null;
  }
}

/**
 * Create a backup job in the database
 */
function createBackupJob(type = 'full', trigger = 'manual', triggeredBy = 'system') {
  const sql = `SELECT create_backup_job('${type}', '${trigger}', '${triggeredBy}')`;
  const jobId = pgQuery(sql);
  if (jobId) {
    activeJobs.set(jobId, { status: 'pending', startedAt: new Date() });
  }
  return jobId;
}

/**
 * Update backup job status in database
 */
function updateBackupJob(jobId, status, options = {}) {
  const { filePath, fileSize, manifest, errorMessage, errorDetails } = options;

  let sql = `SELECT update_backup_job('${jobId}', '${status}'`;

  if (filePath) sql += `, '${filePath}'`;
  else sql += `, NULL`;

  if (fileSize) sql += `, ${fileSize}`;
  else sql += `, NULL`;

  if (manifest) sql += `, '${JSON.stringify(manifest).replace(/'/g, "''")}'::jsonb`;
  else sql += `, NULL`;

  if (errorMessage) sql += `, '${errorMessage.replace(/'/g, "''")}'`;
  else sql += `, NULL`;

  if (errorDetails) sql += `, '${JSON.stringify(errorDetails).replace(/'/g, "''")}'::jsonb`;
  else sql += `, NULL`;

  sql += `)`;

  pgQuery(sql);
  activeJobs.set(jobId, { ...activeJobs.get(jobId), status });
}

/**
 * Get backup job from database
 */
function getBackupJob(jobId) {
  const sql = `SELECT row_to_json(bj) FROM backup_jobs bj WHERE id = '${jobId}'`;
  const result = pgQuery(sql);
  if (result) {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Run the backup script and track progress
 */
async function runBackup(jobId, type = 'full') {
  const scriptPath = '/usr/local/bin/backup-substrate.sh';

  // Mark job as running
  updateBackupJob(jobId, 'running');

  return new Promise((resolve) => {
    const args = type === 'data-only' ? ['--data-only'] : ['--full'];
    const proc = spawn(scriptPath, args, {
      env: { ...process.env, JOB_ID: jobId },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[backup:${jobId}]`, data.toString().trim());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[backup:${jobId}] ERROR:`, data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Parse manifest from backup output
        const manifest = parseManifest(stdout);
        const backupFile = findLatestBackup();

        updateBackupJob(jobId, 'completed', {
          filePath: backupFile?.path,
          fileSize: backupFile?.size,
          manifest
        });

        resolve({ success: true, jobId, manifest });
      } else {
        updateBackupJob(jobId, 'failed', {
          errorMessage: `Backup script exited with code ${code}`,
          errorDetails: { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }
        });

        resolve({ success: false, jobId, error: stderr || 'Backup failed' });
      }
    });

    proc.on('error', (err) => {
      updateBackupJob(jobId, 'failed', {
        errorMessage: err.message,
        errorDetails: { code: err.code }
      });
      resolve({ success: false, jobId, error: err.message });
    });
  });
}

/**
 * Parse manifest from backup output
 */
function parseManifest(output) {
  const manifest = { tables: {}, domains: {}, timestamp: new Date().toISOString() };

  // Look for table count lines: "users: 150 rows"
  const tableMatches = output.matchAll(/(\w+):\s*(\d+)\s*rows?/gi);
  for (const match of tableMatches) {
    manifest.tables[match[1]] = parseInt(match[2], 10);
  }

  // Look for domain summary
  const domainMatches = output.matchAll(/Domain\s+(\w+):\s*(\d+)/gi);
  for (const match of domainMatches) {
    manifest.domains[match[1]] = parseInt(match[2], 10);
  }

  return manifest;
}

/**
 * Find the most recent backup file
 */
function findLatestBackup() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('substrate_backup_'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
        size: fs.statSync(path.join(BACKUP_DIR, f)).size
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files[0] || null;
  } catch {
    return null;
  }
}

/**
 * Run restore operation
 */
async function runRestore(jobId, backupPath, dryRun = true) {
  const scriptPath = '/usr/local/bin/restore-substrate.sh';

  updateBackupJob(jobId, 'running');

  return new Promise((resolve) => {
    const args = [backupPath];
    if (dryRun) args.push('--dry-run');

    const proc = spawn(scriptPath, args, {
      env: { ...process.env, JOB_ID: jobId },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        updateBackupJob(jobId, 'completed', {
          manifest: { restorePath: backupPath, dryRun }
        });
        resolve({ success: true, jobId, output: stdout });
      } else {
        updateBackupJob(jobId, 'failed', {
          errorMessage: `Restore failed with code ${code}`,
          errorDetails: { stderr }
        });
        resolve({ success: false, jobId, error: stderr });
      }
    });
  });
}

/**
 * HTTP Request Handler
 */
function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Collect request body
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      let data = {};
      if (body) {
        try {
          data = JSON.parse(body);
        } catch {
          // Ignore parse errors
        }
      }

      // Route handling
      if (pathname === '/health' && method === 'GET') {
        // Health check
        const dbOk = pgQuery('SELECT 1') === '1';
        res.writeHead(dbOk ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: dbOk ? 'healthy' : 'unhealthy',
          database: dbOk ? 'connected' : 'disconnected',
          timestamp: new Date().toISOString()
        }));
      }
      else if (pathname === '/backup' && method === 'POST') {
        // Trigger backup
        const type = data.type || 'full';
        const trigger = data.trigger || 'manual';
        const triggeredBy = data.triggeredBy || 'api';

        const jobId = createBackupJob(type, trigger, triggeredBy);
        if (!jobId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to create backup job' }));
          return;
        }

        // Start backup asynchronously
        runBackup(jobId, type).then(result => {
          console.log(`Backup ${jobId} completed:`, result.success ? 'SUCCESS' : 'FAILED');
        });

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          jobId,
          message: 'Backup started'
        }));
      }
      else if (pathname.startsWith('/status/') && method === 'GET') {
        // Get job status
        const jobId = pathname.split('/')[2];
        const job = getBackupJob(jobId);

        if (job) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(job));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Job not found' }));
        }
      }
      else if (pathname === '/restore' && method === 'POST') {
        // Restore from backup
        const { backupPath, dryRun = true } = data;

        if (!backupPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'backupPath is required' }));
          return;
        }

        const jobId = createBackupJob('restore', 'manual', data.triggeredBy || 'api');
        if (!jobId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to create restore job' }));
          return;
        }

        // Start restore asynchronously
        runRestore(jobId, backupPath, dryRun).then(result => {
          console.log(`Restore ${jobId} completed:`, result.success ? 'SUCCESS' : 'FAILED');
        });

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          jobId,
          message: dryRun ? 'Dry-run restore started' : 'Restore started'
        }));
      }
      else if (pathname === '/jobs' && method === 'GET') {
        // List recent jobs
        const limit = url.searchParams.get('limit') || 10;
        const sql = `
          SELECT row_to_json(bj)
          FROM backup_jobs bj
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT ${parseInt(limit, 10)}
        `;
        const result = pgQuery(sql.replace(/\n/g, ' '));
        let jobs = [];
        if (result) {
          // Multiple rows come back as newline-separated JSON
          jobs = result.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobs }));
      }
      else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      console.error('Request error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backup API server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Trigger backup: POST http://localhost:${PORT}/backup`);
  console.log(`Get status: GET http://localhost:${PORT}/status/:id`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  server.close(() => {
    process.exit(0);
  });
});
