#!/usr/bin/env node
/**
 * Apply ChartFlo's SQL migrations to the Aurora cluster via the RDS Data API.
 *
 * Usage:
 *   node infra/aws/apply-migrations.mjs [--dry-run]
 *
 * Requires AWS credentials (uses the AWS CLI) and these env vars or defaults:
 *   CLUSTER_ARN, SECRET_ARN, DB_NAME (default chartflo), AWS_REGION (default us-east-2)
 *
 * Statements are split on top-level semicolons (respecting $$-quoted bodies,
 * quotes, and comments) because the Data API executes one statement at a time.
 * Failures are collected and reported rather than aborting the run, so
 * Supabase-specific statements that don't apply can be reviewed afterwards.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLUSTER_ARN = process.env.CLUSTER_ARN || 'arn:aws:rds:us-east-2:557485610536:cluster:chartflo';
const SECRET_ARN = process.env.SECRET_ARN || 'arn:aws:secretsmanager:us-east-2:557485610536:secret:rds!cluster-52cb2016-c3c0-4247-a32b-0ba3a7d24143-szaMiY';
const DB_NAME = process.env.DB_NAME || 'chartflo';
const REGION = process.env.AWS_REGION || 'us-east-2';
const DRY_RUN = process.argv.includes('--dry-run');

function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let i = 0;
  let inSingle = false, inDollar = null, inLineComment = false, inBlockComment = false;
  while (i < sql.length) {
    const ch = sql[i], two = sql.slice(i, i + 2);
    if (inLineComment) { if (ch === '\n') inLineComment = false; cur += ch; i++; continue; }
    if (inBlockComment) { if (two === '*/') { inBlockComment = false; cur += two; i += 2; continue; } cur += ch; i++; continue; }
    if (inSingle) { if (ch === "'" && sql[i + 1] === "'") { cur += "''"; i += 2; continue; } if (ch === "'") inSingle = false; cur += ch; i++; continue; }
    if (inDollar) {
      if (sql.startsWith(inDollar, i)) { cur += inDollar; i += inDollar.length; inDollar = null; continue; }
      cur += ch; i++; continue;
    }
    if (two === '--') { inLineComment = true; cur += two; i += 2; continue; }
    if (two === '/*') { inBlockComment = true; cur += two; i += 2; continue; }
    if (ch === "'") { inSingle = true; cur += ch; i++; continue; }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[a-zA-Z_]*\$/);
      if (m) { inDollar = m[0]; cur += m[0]; i += m[0].length; continue; }
    }
    if (ch === ';') {
      const s = cur.trim();
      if (s) stmts.push(s);
      cur = '';
      i++;
      continue;
    }
    cur += ch; i++;
  }
  const tail = cur.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function exec(sql) {
  execFileSync('aws', [
    'rds-data', 'execute-statement',
    '--resource-arn', CLUSTER_ARN,
    '--secret-arn', SECRET_ARN,
    '--database', DB_NAME,
    '--region', REGION,
    '--sql', sql,
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined } });
}

const shimDir = join(process.cwd(), 'infra/aws/schema');
const migDir = join(process.cwd(), 'supabase/migrations');
const files = [
  ...readdirSync(shimDir).filter(f => f.endsWith('.sql')).sort().map(f => join(shimDir, f)),
  ...readdirSync(migDir).filter(f => f.endsWith('.sql')).sort().map(f => join(migDir, f)),
];

let ok = 0, failed = [];
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  const stmts = splitStatements(sql);
  for (const [idx, stmt] of stmts.entries()) {
    if (DRY_RUN) { ok++; continue; }
    try {
      exec(stmt);
      ok++;
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message).split('\n')[0].slice(0, 300);
      failed.push({ file: file.split('/').pop(), idx, msg, head: stmt.slice(0, 100).replace(/\s+/g, ' ') });
    }
  }
  process.stdout.write(`${file.split('/').pop()}: ${stmts.length} stmts\n`);
}

console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}OK: ${ok}, failed: ${failed.length}`);
for (const f of failed) console.log(`  FAIL ${f.file}#${f.idx}: ${f.msg}\n       ${f.head}…`);
process.exit(0);
