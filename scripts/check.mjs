import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
for(const file of [manifest.background.service_worker,manifest.options_page,manifest.action.default_popup,...Object.values(manifest.icons),...Object.values(manifest.action.default_icon||{}),...manifest.content_scripts.flatMap(x=>[...x.js,...x.css])])if(!fs.existsSync(path.join(extension,file)))throw new Error(`Missing manifest file: ${file}`);
if(manifest.default_locale){
  const localeRoot=path.join(extension,'_locales');
  const locales=fs.readdirSync(localeRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
  if(!locales.includes(manifest.default_locale))throw new Error('Missing default locale');
  const keys=[...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(match=>match[1]);
  for(const locale of locales){
    const messages=JSON.parse(fs.readFileSync(path.join(localeRoot,locale,'messages.json'),'utf8'));
    for(const key of keys)if(!messages[key]?.message)throw new Error(`Missing ${locale} message: ${key}`);
    if(messages.extensionName.message.length>75||messages.extensionDescription.message.length>132)throw new Error(`Store metadata too long: ${locale}`);
  }
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(extension)){
  if(file.endsWith('.js'))execFileSync(process.execPath,['--check',file]);
  if(file.endsWith('.html')){
    const text=fs.readFileSync(file,'utf8');
    if(/<script(?![^>]*src=)[^>]*>\s*\S/i.test(text)||/\son\w+\s*=/.test(text))throw new Error(`Inline script in ${file}`);
    for(const match of text.matchAll(/(?:src|href)="([^"#]+)"/g)){const url=match[1];if(!/^https?:|^chrome:|^mailto:/.test(url)&&!fs.existsSync(path.join(path.dirname(file),url)))throw new Error(`Missing asset: ${url}`);}
  }
}
if(manifest.permissions.some(p=>!['storage','alarms','cookies'].includes(p)))throw new Error('Unexpected privilege');
execFileSync(process.execPath,[path.join(root,'scripts/sync-official-list.mjs'),'--check'],{stdio:'inherit'});
console.log('Manifest, linked assets, script syntax and CSP checks passed.');
