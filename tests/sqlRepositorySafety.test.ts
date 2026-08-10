import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const migrationsRoot = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

const migrationFiles = readdirSync(migrationsRoot)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

const migrationSource = migrationFiles
  .map((fileName) => readFileSync(new URL(`../supabase/migrations/${fileName}`, import.meta.url), 'utf8'))
  .join('\n');

test('database evolution only uses the timestamped migration chain', () => {
  const rootSqlFiles = readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name);

  assert.deepEqual(
    rootSqlFiles,
    [],
    `Do not add executable SQL patches at the repository root: ${rootSqlFiles.join(', ')}`,
  );
  assert.ok(migrationFiles.length > 0);
  assert.ok(migrationFiles.every((fileName) => /^\d{14}_[a-z0-9_]+\.sql$/.test(fileName)));
});

test('migration chain does not restore retired activity access or data repair rules', () => {
  assert.doesNotMatch(
    migrationSource,
    /using\s*\(\s*user_id\s+is\s+null\s*\)/i,
    'Anonymous or orphan activity reads must never be reintroduced.',
  );
  assert.doesNotMatch(
    migrationSource,
    /create\s+policy[\s\S]{0,160}on\s+(?:public\.)?activities[\s\S]{0,120}for\s+delete/i,
    'Activities are an audit ledger and must not have a client DELETE policy.',
  );
  assert.doesNotMatch(
    migrationSource,
    /grant\s+delete\s+on\s+(?:table\s+)?(?:public\.)?activities/i,
    'Authenticated clients must not receive physical DELETE access to activities.',
  );
  assert.doesNotMatch(
    migrationSource,
    /update\s+(?:public\.)?activities\s+set\s+count\s*=\s*1\s+where\s+count\s+is\s+null\s+or\s+count\s*=\s*0/i,
    'Explicit zero activity counts are invalid data, not legacy missing values.',
  );
});

test('security hardening migrations remain part of the canonical chain', () => {
  const requiredMigrations = [
    '20260810120000_remove_unsafe_core_table_access.sql',
    '20260810124500_revoke_core_physical_delete.sql',
    '20260810230000_harden_warehouse_master_data.sql',
  ];

  for (const fileName of requiredMigrations) {
    assert.ok(migrationFiles.includes(fileName), `Required hardening migration is missing: ${fileName}`);
  }
});
