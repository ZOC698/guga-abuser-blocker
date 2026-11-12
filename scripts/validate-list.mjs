import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, MAX_BYTES, MAX_ENTRIES, normalizeHandle } from '../extension/lib/core.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const topKeys = new Set(['schema', 'name', 'updatedAt', 'entries']);
const entryKeys = new Set(['handle', 'id', 'reason', 'evidence']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function requireKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains an unsupported field: ${key}`);
}

export function validateTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new Error('updatedAt must be a UTC ISO timestamp.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('updatedAt is not a valid calendar date.');
  return parsed.toISOString();
}

export function validatePublicEntry(entry, index = 0) {
  const label = `Entry ${index + 1}`;
  requireObject(entry, label);
  requireKeys(entry, entryKeys, label);
  if (typeof entry.handle !== 'string' || normalizeHandle(entry.handle) !== entry.handle) throw new Error(`${label}: handle must be a lowercase username without @.`);
  if (Object.hasOwn(entry, 'id') && (typeof entry.id !== 'string' || !/^\d{1,25}$/.test(entry.id))) throw new Error(`${label}: optional id must be a decimal string.`);
  if (typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 1000 || entry.reason !== entry.reason.trim()) throw new Error(`${label}: a reviewed reason of 1–1,000 characters is required.`);
  if (!Array.isArray(entry.evidence) || entry.evidence.length < 1 || entry.evidence.length > 10) throw new Error(`${label}: provide 1–10 HTTPS evidence links.`);
  const evidence = new Set();
  for (const value of entry.evidence) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${label}: evidence must be an HTTPS URL.`); }
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://') || /\s/.test(value) || url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label}: evidence must be an HTTPS URL without embedded credentials.`);
    if (evidence.has(url.href)) throw new Error(`${label}: duplicate evidence URL.`);
    evidence.add(url.href);
  }
  return entry;
}

export function validatePublicList(document) {
  requireObject(document, 'List');
  requireKeys(document, topKeys, 'List');
  if (document.schema !== SCHEMA) throw new Error(`schema must be ${SCHEMA}.`);
  if (typeof document.name !== 'string' || !document.name.trim() || document.name.length > 120 || document.name !== document.name.trim()) throw new Error('name must be 1–120 characters.');
  validateTimestamp(document.updatedAt);
  if (!Array.isArray(document.entries) || document.entries.length > MAX_ENTRIES) throw new Error(`entries must be an array with at most ${MAX_ENTRIES} rows.`);
  const handles = new Set();
  const ids = new Set();
  document.entries.forEach((entry, index) => {
    validatePublicEntry(entry, index);
    if (handles.has(entry.handle)) throw new Error(`Entry ${index + 1}: duplicate handle.`);
    handles.add(entry.handle);
    if (entry.id && ids.has(entry.id)) throw new Error(`Entry ${index + 1}: duplicate numeric ID; review renamed-account mappings.`);
    if (entry.id) ids.add(entry.id);
  });
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_BYTES) throw new Error('Public list exceeds 4 MiB.');
  return { entries: document.entries.length, withNumericId: ids.size, withoutNumericId: document.entries.length - ids.size };
}

export async function readJSON(filename) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Input must be a JSON file no larger than 4 MiB.');
  let text = await fs.readFile(filename, 'utf8');
  text = text.replace(/^\uFEFF/, '');
  try { return JSON.parse(text); } catch { throw new Error('Input is not valid JSON.'); }
}

export async function validateFile(filename) {
  return validatePublicList(await readJSON(filename));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/validate-list.mjs [lists/guga-blocklist.json]');
  } else if (args.length > 1) {
    console.error('Pass one public JSON file.');
    process.exitCode = 1;
  } else {
    const filename = args[0] ? path.resolve(args[0]) : path.join(projectRoot, 'lists/guga-blocklist.json');
    try { console.log(JSON.stringify({ ok: true, ...await validateFile(filename) })); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
