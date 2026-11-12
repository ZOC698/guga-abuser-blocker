import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublicList} from './validate-list.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const document = JSON.parse(await fs.readFile(path.join(root, 'lists/guga-blocklist.json'), 'utf8'));
validatePublicList(document);
const output = path.join(root, 'extension/lib/official-list.js');
const generated = `// Generated from lists/guga-blocklist.json by scripts/sync-official-list.mjs.
// Packaged public data only; no remote JavaScript is executed.
export const OFFICIAL_SUBSCRIPTION_ID = 'guga-official';
export const OFFICIAL_SUBSCRIPTION_URL = 'https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json';
export const OFFICIAL_SUBSCRIPTION_NAME = 'Guga official blocklist';
export const OFFICIAL_LIST_VERSION = 1;
export const OFFICIAL_SEED = ${JSON.stringify(document, null, 2)};
`;
if (process.argv.includes('--check')) {
  const existing = await fs.readFile(output, 'utf8');
  if (existing.replace(/\r\n/g, '\n') !== generated) throw new Error('Bundled default list differs from the public list. Run npm run sync:official.');
  console.log(`Bundled default list matches ${document.entries.length} public entries.`);
} else {
  await fs.writeFile(output, generated, 'utf8');
  console.log(`Bundled ${document.entries.length} public entries.`);
}
