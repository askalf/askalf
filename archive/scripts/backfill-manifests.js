#!/usr/bin/env node
// One-time script: backfill manifest data into backup_jobs records
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = "/backups/daily";
const files = fs.readdirSync(dir).filter(f => f.startsWith("substrate_backup_")).sort();
const key = process.env.BACKUP_ENCRYPTION_KEY;

if (!key) {
  console.error("BACKUP_ENCRYPTION_KEY not set");
  process.exit(1);
}

const env = { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD };

for (const fname of files) {
  const fp = path.join(dir, fname);
  const dateMatch = fname.match(/substrate_backup_(\d{4})(\d{2})(\d{2})/);
  if (!dateMatch) continue;
  const ts = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

  try {
    const cmd = `openssl enc -aes-256-cbc -d -salt -pbkdf2 -iter 100000 -in "${fp}" -pass pass:"${key}" 2>/dev/null | tar -xzf - -O manifest.json 2>/dev/null`;
    const manifest = execSync(cmd, { encoding: "utf8", timeout: 60000 });
    const parsed = JSON.parse(manifest);
    const escaped = JSON.stringify(parsed).replace(/'/g, "''");
    const sql = `UPDATE backup_jobs SET manifest = '${escaped}'::jsonb WHERE status = 'completed' AND created_at::date = '${ts}' AND (manifest IS NULL OR manifest = '{}'::jsonb OR manifest->'tables' = '{}'::jsonb);`;
    execSync(`psql -h postgres -U substrate -d substrate -c "${sql.replace(/"/g, '\\"')}"`, { env, encoding: "utf8", timeout: 10000 });
    const domains = Object.keys(parsed.domains || {}).length;
    console.log(`OK ${ts} - ${domains} domains`);
  } catch (e) {
    console.log(`SKIP ${fname} - ${e.message.slice(0, 80)}`);
  }
}
console.log("Manifest backfill complete");
