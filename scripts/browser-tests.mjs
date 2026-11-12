import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
let browser;
try { browser=require(process.env.PLAYWRIGHT_MODULE||'playwright'); }
catch { throw new Error('Browser tests are required. Run npm ci and npx playwright install chromium, or set PLAYWRIGHT_MODULE.'); }
const executable=process.env.GAB_CHROMIUM_PATH||browser.chromium.executablePath();
if(!fs.existsSync(executable))throw new Error('Chromium is missing. Browser tests cannot be skipped.');
const result=spawnSync(process.execPath,['--test','tests/content.test.js','tests/integration.test.js','tests/session-transport.test.js'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
