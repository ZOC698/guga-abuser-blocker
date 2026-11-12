import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);let pw;
try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{}
const project=path.resolve(import.meta.dirname,'..');
const outputs=path.resolve(project,'..');

function fixture(url, blocked=false) {
  const handle=new URL(url).pathname.slice(1)||'home';
  return `<!doctype html><html><body><button data-testid="SideNav_AccountSwitcher_Button">Owner<br>@fixture_owner</button><main><div data-testid="primaryColumn"><div data-testid="UserName">Fixture<br>@${handle}</div><button data-testid="userActions">More</button><button id="target" data-testid="1234567890123456789-${blocked?'unblock':'follow'}">Follow</button></div></main><script>
  document.querySelector('[data-testid="userActions"]').onclick=()=>{
    const menu=document.createElement('div');menu.setAttribute('role','menu');
    const button=document.createElement('button');button.dataset.testid='block';button.textContent='Block @${handle}';menu.append(button);document.body.append(menu);
    button.onclick=()=>{menu.remove();const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='Block @${handle}?';const confirm=document.createElement('button');confirm.dataset.testid='confirmationSheetConfirm';confirm.textContent='Block';dialog.append(confirm);document.body.append(dialog);confirm.onclick=async()=>{await fetch('/__fixture/block?handle=${handle}',{method:'POST'});document.querySelector('#target').dataset.testid='1234567890123456789-unblock';document.querySelector('#target').textContent='Blocked';dialog.remove();};};
  };</script></body></html>`;
}

test('real unpacked MV3 extension: import, review, locales, export, account-bound queue and popup', {skip:!pw&&'Set PLAYWRIGHT_MODULE or install playwright.'},async()=>{
  const work=path.resolve(project,'../../work');await fs.mkdir(work,{recursive:true});const profile=await fs.mkdtemp(path.join(work,'test-browser-'));
  const extension=path.join(project,'extension');
  const context=await pw.chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,...(process.env.GAB_CHROMIUM_PATH?{executablePath:process.env.GAB_CHROMIUM_PATH}:{}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP x.com ~NOTFOUND, MAP twitter.com ~NOTFOUND'],viewport:{width:1360,height:1000}});
  let remoteRequests=0, blockRequests=0, targetNavigations=0;const blockedHandles=new Set();
  await context.route('https://**/*',async route=>{const url=new URL(route.request().url());if(url.origin==='https://x.com'){
    if(url.pathname==='/__fixture/block'){assert.equal(route.request().method(),'POST');blockedHandles.add(url.searchParams.get('handle'));blockRequests++;return route.fulfill({json:{ok:true}});}
    if(url.pathname==='/fixture_target')targetNavigations++;
    return route.fulfill({contentType:'text/html',body:fixture(url.href,blockedHandles.has(url.pathname.slice(1)))});
  }remoteRequests++;return route.abort();});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForFunction(()=>document.querySelector('#language').value==='zh');
    const send=(type,payload={})=>page.evaluate(async({type,payload})=>chrome.runtime.sendMessage({type,...payload}),{type,payload});
    assert.equal((await send('GET_STATE')).ok,true);
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();
    // Synthetic data only: tests never read a maintainer's private review file.
    await page.locator('#import-text').fill(Array.from({length:523},(_,i)=>`@pending_${i}`).join('\n'));
    await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden,null,{timeout:10000});
    let state=(await send('GET_STATE')).state;assert.equal(state.entries.length,523);assert.ok(state.entries.every(e=>e.status==='pending'));
    assert.equal((await send('EXPORT',{kind:'public'})).ok,false);assert.equal(await page.locator('#export-public').count(),0);
    for(const language of ['en','ja','zh']){await page.locator('#language').selectOption(language);await page.waitForFunction(lang=>document.documentElement.lang===(lang==='zh'?'zh-CN':lang),language);assert.equal((await send('GET_STATE')).state.settings.language,language);}
    await page.locator('[data-panel="overview"]').click();await page.screenshot({path:path.join(outputs,'guga-blocker-preview.png'),fullPage:true});
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();await page.locator('#import-text').fill('@fixture_target');await page.locator('#confirm-import').click();
    await page.locator('#search').fill('fixture_target');await page.locator('[data-select-handle="fixture_target"]').check();await page.locator('#approve-selected').click();
    await page.locator('#status-filter').selectOption('all');
    await page.locator('[data-edit-handle="fixture_target"]').click();await page.locator('#edit-reason').fill('Fixture reason');await page.locator('#edit-evidence').fill('https://x.com/fixture_target/status/1');await page.locator('#entry-form button[type="submit"]').click();
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='fixture_target').reason,'Fixture reason');
    await page.locator('[data-edit-handle="fixture_target"]').click();await page.locator('#edit-id').fill('1234567890123456789');await page.locator('#entry-form button[type="submit"]').click();
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='fixture_target').id,'1234567890123456789');
    const downloadEvent=page.waitForEvent('download');await page.locator('#export-kind').selectOption('private');await page.locator('#export-list').click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'guga-private-backup.json');
    const x=await context.newPage();await x.goto('https://x.com/home');await x.waitForFunction(()=>!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'));
    await page.bringToFront();await page.locator('[data-panel="settings"]').click();await page.locator('#bind-account').click();await page.waitForFunction(()=>document.querySelector('#bound-account').textContent.includes('fixture_owner'));
    // Exercise the production tab creation path. No fixture-written workerTabId.
    await page.bringToFront();
    await page.locator('#auto-block').check();await page.locator('[data-panel="overview"]').click();await page.locator('#queue-start').click();
    for(let i=0;i<100;i++){state=(await send('GET_STATE')).state;const job=state.queue.find(j=>j.handle==='fixture_target');if(['done','failed','uncertain'].includes(job?.status))break;await new Promise(resolve=>setTimeout(resolve,250));}
    assert.equal(state.queue.find(j=>j.handle==='fixture_target')?.status,'done',JSON.stringify(state.queue));assert.ok(state.nativeBlocked.fixture_owner['id:1234567890123456789']);assert.equal(state.entries.find(e=>e.handle==='fixture_target').id,'1234567890123456789');assert.equal(state.queue.length,1);assert.equal(blockRequests,1);assert.ok(targetNavigations>=2,'Result must be rechecked after a real navigation');
    await page.locator('#queue-pause').click();await page.reload();assert.equal((await send('GET_STATE')).state.paused,true);
    await page.setViewportSize({width:800,height:900});await page.locator('[data-panel="settings"]').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForFunction(()=>document.body.innerText.includes('Guga'));assert.ok(await page.locator('button').count()>0);
    assert.deepEqual(errors,[]);assert.equal(remoteRequests,0);
    await fs.writeFile(path.join(outputs,'integration-result.json'),JSON.stringify({passed:true,version:'0.1.1',syntheticEntries:523,locales:['zh','en','ja'],nativeBlock:'simulated X DOM; no live account actions',realExtensionLoaded:true,productionWorkerCreation:true,reloadedResult:true,blockRequests,pageErrors:errors,unexpectedRemoteRequests:remoteRequests},null,2));
  }catch(error){console.error(JSON.stringify({errors,toast:await page.locator('#toast').textContent().catch(()=>''),pages:await Promise.all(context.pages().map(async p=>({url:p.url(),text:(await p.locator('body').innerText()).slice(-500)})))},null,2));await page.screenshot({path:path.join(work,'integration-failure.png'),fullPage:true});throw error;}finally{await context.close();}
});
