import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
for(const file of [manifest.background.service_worker,manifest.options_page,manifest.action.default_popup,...Object.values(manifest.icons),...manifest.content_scripts.flatMap(x=>[...x.js,...x.css])])if(!fs.existsSync(path.join(extension,file)))throw new Error(`Missing manifest file: ${file}`);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(extension)){
  if(file.endsWith('.js'))execFileSync(process.execPath,['--check',file]);
  if(file.endsWith('.html')){
    const text=fs.readFileSync(file,'utf8');
    if(/<script(?![^>]*src=)[^>]*>\s*\S/i.test(text)||/\son\w+\s*=/.test(text))throw new Error(`Inline script in ${file}`);
    for(const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)){const url=match[1];if(!/^https?:|^chrome:|^mailto:/.test(url)&&!fs.existsSync(path.join(path.dirname(file),url)))throw new Error(`Missing asset: ${url}`);}
  }
}
if(manifest.permissions.some(p=>!['storage','alarms','scripting'].includes(p)))throw new Error('Unexpected privilege');
console.log('Manifest, linked assets, script syntax and CSP checks passed.');
