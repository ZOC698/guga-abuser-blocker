import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);let pw;
try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{}
const project=path.resolve(import.meta.dirname,'..');
const outputs=path.resolve(project,'..');

test('real unpacked MV3 extension: import, review, locales, export, account-bound queue and popup', {skip:!pw&&'Set PLAYWRIGHT_MODULE or install playwright.'},async(t)=>{
  const work=path.resolve(project,'../../work');await fs.mkdir(work,{recursive:true});const profile=await fs.mkdtemp(path.join(work,'test-browser-'));
  const extension=path.join(project,'extension');
  const context=await pw.chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,...(process.env.GAB_CHROMIUM_PATH?{executablePath:process.env.GAB_CHROMIUM_PATH}:{}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP x.com ~NOTFOUND, MAP twitter.com ~NOTFOUND'],viewport:{width:1360,height:1000}});
  t.after(()=>context.close());
  let remoteRequests=0, blockRequests=0, relationshipReads=0, pageNavigations=0;let blocking=false;const accountId='9876543210987654321',targetId='1234567890123456789',csrf='a'.repeat(64);
  const expires=Math.floor(Date.now()/1000)+3600;
  await context.addCookies([{name:'twid',value:`u%3D${accountId}`,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},{name:'ct0',value:csrf,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},{name:'auth_token',value:'synthetic-isolated-cookie',domain:'.x.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires}]);
  await context.route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin==='https://x.com'&&url.pathname.startsWith('/i/api/1.1/')){
      const headers=await request.allHeaders();
      assert.equal(headers['x-csrf-token'],csrf);
      // Routing intercepts before Chromium attaches Cookie. A separate loopback
      // transport test observes cookies at the server; do not infer that here.
      assert.ok(request.serviceWorker(),'API calls must originate in the extension worker');
      if(url.pathname.endsWith('/account/settings.json'))return route.fulfill({json:{screen_name:'fixture_owner'}});
      if(url.pathname.endsWith('/users/show.json')){
        if(url.searchParams.get('screen_name')==='fixture_owner')return route.fulfill({json:{id_str:accountId,screen_name:'fixture_owner'}});
        assert.equal(url.searchParams.get('user_id'),targetId);relationshipReads++;
        return route.fulfill({json:{id_str:targetId,screen_name:'fixture_target',blocking}});
      }
      if(url.pathname.endsWith('/blocks/create.json')){
        assert.equal(request.method(),'POST');assert.equal(request.postData(),'user_id='+targetId);blocking=true;blockRequests++;
        return route.fulfill({json:{id_str:targetId,screen_name:'fixture_target',blocking:true}});
      }
    }
    if(url.origin==='https://x.com')pageNavigations++;
    remoteRequests++;return route.abort();
  });
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
    await page.bringToFront();await page.locator('[data-panel="settings"]').click();await page.locator('#bind-account').click();
    await page.waitForFunction(()=>document.querySelector('#bound-account').textContent.includes('fixture_owner'));
    assert.equal((await send('GET_STATE')).state.settings.accountId,accountId);
    const beforeQueuePages=context.pages().length;
    await page.locator('#auto-block').check();await page.locator('[data-panel="overview"]').click();await page.locator('#queue-start').click();
    for(let i=0;i<100;i++){state=(await send('GET_STATE')).state;const job=state.queue.find(j=>j.handle==='fixture_target');if(['done','failed','uncertain'].includes(job?.status))break;await new Promise(resolve=>setTimeout(resolve,250));}
    assert.equal(state.queue.find(j=>j.handle==='fixture_target')?.status,'done',JSON.stringify(state.queue));assert.ok(state.nativeBlocked['id:'+accountId]['id:1234567890123456789']);assert.equal(state.entries.find(e=>e.handle==='fixture_target').id,'1234567890123456789');assert.equal(state.queue.length,1);assert.equal(blockRequests,1);assert.equal(relationshipReads,2,'Preflight and independent API readback are required');assert.equal(context.pages().length,beforeQueuePages,'API execution must not create a worker tab');assert.equal(pageNavigations,0);
    await page.locator('#queue-pause').click();await page.reload();assert.equal((await send('GET_STATE')).state.paused,true);
    await page.setViewportSize({width:800,height:900});await page.locator('[data-panel="settings"]').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const pageCount=context.pages().length;
    await page.setViewportSize({width:450,height:580});
    await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForSelector('#language');
    assert.equal(await page.locator('#open-dashboard').count(),0);
    for(const language of ['en','ja','zh']){
      await page.locator('#language').selectOption(language);
      for(const panel of ['overview','library','subscriptions','activity','settings']){
        await page.locator(`[data-panel="${panel}"]`).click();
        assert.equal(await page.locator(`#panel-${panel}`).isVisible(),true);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${language}/${panel} overflow`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),`${language}/${panel} should scroll inside the popup`);
      }
    }
    await page.locator('#bind-account').click();
    await page.waitForFunction(()=>document.querySelector('#bound-account').textContent.includes('fixture_owner'));
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();
    await page.locator('#import-text').fill('@popup_draft');
    await page.waitForFunction(async()=>JSON.stringify(await chrome.storage.session.get(null)).includes('@popup_draft'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#import-text')?.value==='@popup_draft');
    assert.equal(await page.locator('#panel-library').isVisible(),true);
    await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden);
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='popup_draft')?.status,'pending');
    const popupDownload=page.waitForEvent('download');await page.locator('#export-list').click();assert.equal((await popupDownload).suggestedFilename(),'guga-private-backup.json');
    await page.locator('[data-panel="subscriptions"]').click();await page.locator('#sub-name').fill('Draft subscription');await page.locator('#sub-url').fill('https://raw.githubusercontent.com/fixture/repo/main/list.json');
    await page.waitForFunction(async()=>JSON.stringify(await chrome.storage.session.get(null)).includes('Draft subscription'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#sub-name')?.value==='Draft subscription');assert.equal(await page.locator('#panel-subscriptions').isVisible(),true);
    await page.locator('[data-panel="settings"]').click();await page.screenshot({path:path.join(outputs,'guga-popup-0.2.0-fixture.png')});
    assert.equal(context.pages().length,pageCount,'Management must not open another tab/window');
    assert.deepEqual(errors,[]);assert.equal(remoteRequests,0);
    await fs.writeFile(path.join(outputs,'integration-result.json'),JSON.stringify({passed:true,version:'0.2.0',syntheticEntries:523,locales:['zh','en','ja'],nativeBlock:'production API executor with intercepted X responses and synthetic cookies; no live account actions',realExtensionLoaded:true,workerApiRequests:true,noExecutionTab:true,relationshipReadback:true,relationshipReads,popupManagement:true,popupDraftRecovery:true,blockRequests,pageErrors:errors,unexpectedRemoteRequests:remoteRequests},null,2));
  }catch(error){console.error(JSON.stringify({errors,toast:await page.locator('#toast').textContent().catch(()=>''),pages:await Promise.all(context.pages().map(async p=>({url:p.url(),text:(await p.locator('body').innerText()).slice(-500)})))},null,2));await page.screenshot({path:path.join(work,'integration-failure.png'),fullPage:true});throw error;}finally{await context.close();}
});
