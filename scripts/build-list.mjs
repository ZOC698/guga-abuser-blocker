import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SCHEMA, MAX_BYTES, MAX_ENTRIES, normalizeHandle } from '../extension/lib/core.js';
import { readJSON, validatePublicList, validateTimestamp } from './validate-list.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statuses = new Set(['pending', 'approved', 'excluded']);

export function buildPublicList(review, { name = 'Guga community blocklist', updatedAt = new Date().toISOString() } = {}) {
  if (!review || typeof review !== 'object' || Array.isArray(review) || !Array.isArray(review.entries)) throw new Error('Private review input must contain an entries array.');
  if (review.schema !== SCHEMA) throw new Error(`Review schema must be ${SCHEMA}.`);
  if (review.entries.length > MAX_ENTRIES) throw new Error('Review input has too many rows.');
  if (review.allowlist != null && !Array.isArray(review.allowlist)) throw new Error('Optional allowlist must be an array of handles.');
  const allowlist = new Set((review.allowlist ?? []).map(normalizeHandle));
  const seen = new Set();
  const counts = { pending: 0, approved: 0, excluded: 0, allowlisted: 0 };
  const entries = [];
  review.entries.forEach((row, index) => {
    const label = `Review row ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.handle !== 'string') throw new Error(`${label}: an object with a handle is required.`);
    const handle = normalizeHandle(row.handle);
    if (seen.has(handle)) throw new Error(`${label}: duplicate handle.`);
    seen.add(handle);
    if (!statuses.has(row.status)) throw new Error(`${label}: status must be pending, approved or excluded.`);
    counts[row.status]++;
    if (row.status !== 'approved') return;
    if (row.source != null && row.source !== 'local') throw new Error(`${label}: subscribed entries cannot be republished; use a separately reviewed local record.`);
    const entry = {
      handle,
      ...(Object.hasOwn(row, 'id') ? { id: row.id } : {}),
      reason: typeof row.reason === 'string' ? row.reason.trim() : row.reason,
      evidence: row.evidence
    };
    // Validate each approved row even when excluded by a personal allowlist.
    // An incomplete approval must not look like a successful publish operation.
    validatePublicList({ schema: SCHEMA, name, updatedAt, entries: [entry] });
    if (allowlist.has(handle)) { counts.allowlisted++; return; }
    entries.push(entry);
  });
  entries.sort((left, right) => left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0);
  const document = { schema: SCHEMA, name, updatedAt: validateTimestamp(updatedAt), entries };
  validatePublicList(document);
  return { document, counts: { ...counts, published: entries.length } };
}

export async function buildFile(inputPath, outputPath, options = {}) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const inputReal = await fs.realpath(input);
  const outputReal = await fs.realpath(output).catch(error => { if (error.code === 'ENOENT') return output; throw error; });
  const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (compare(inputReal) === compare(outputReal)) throw new Error('Output cannot replace the private review input.');
  const result = buildPublicList(await readJSON(input), options);
  const data = JSON.stringify(result.document, null, 2) + '\n';
  if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) throw new Error('Formatted public list exceeds 4 MiB.');
  // Perform all review/format validation before creating or replacing any file.
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, data, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { force: true }); }
  return { output, ...result.counts };
}

function parseArguments(args) {
  const options = {};
  const allowed = new Set(['--review', '--output', '--name', '--updated-at']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.has(key) || args[index + 1] == null || args[index + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Invalid option: ${key}`);
    options[key] = args[index + 1];
  }
  if (!options['--review']) throw new Error('--review is required. No private source file is selected automatically.');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/build-list.mjs --review <private-review.json> [--output lists/guga-blocklist.json] [--name "Guga community blocklist"] [--updated-at 2026-11-12T00:00:00.000Z]');
  } else {
    try {
      const options = parseArguments(args);
      const result = await buildFile(options['--review'], options['--output'] ?? path.join(projectRoot, 'lists/guga-blocklist.json'), {
        ...(options['--name'] ? { name: options['--name'] } : {}),
        ...(options['--updated-at'] ? { updatedAt: options['--updated-at'] } : {})
      });
      console.log(JSON.stringify({ ok: true, ...result }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
