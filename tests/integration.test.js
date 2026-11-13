import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {OFFICIAL_SEED,OFFICIAL_SUBSCRIPTION_URL} from '../extension/lib/official-list.js';
const require=createRequire(import.meta.url);let pw;
try{pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{}
const project=path.resolve(import.meta.dirname,'..');
const outputs=path.resolve(project,'..');
const VIEWER_PATH='/i/api/graphql/TpQxQtWMTMnIAMPlMGMqNw/Viewer',REST_PATH='/i/api/graphql/mxaYWwt52eAb6OAzYHMVzg/UserByRestId';
const VIEWER_FEATURES={subscriptions_upsells_api_enabled:false,profile_label_improvements_pcf_label_in_post_enabled:true,responsive_web_profile_redirect_enabled:true,rweb_tipjar_consumption_enabled:false,verified_phone_label_enabled:false,creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true};
const graphUser=(id,handle,blocking=false)=>({data:{user:{result:{__typename:'User',rest_id:id,core:{screen_name:handle},relationship_perspectives:{blocking}}}}});
const graphViewer=(id,handle)=>({data:{viewer:{user_results:{result:graphUser(id,handle).data.user.result}}}});

test('real unpacked MV3 extension: import enabled by default, locales, export, automatic account-bound queue and popup', {skip:!pw&&'Set PLAYWRIGHT_MODULE or install playwright.'},async(t)=>{
  const work=path.resolve(project,'../../work');await fs.mkdir(work,{recursive:true});const profile=await fs.mkdtemp(path.join(work,'test-browser-'));
  const extension=path.join(project,'extension');
  const version=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8')).version;
  const context=await pw.chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,...(process.env.GAB_CHROMIUM_PATH?{executablePath:process.env.GAB_CHROMIUM_PATH}:{}),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP x.com ~NOTFOUND, MAP twitter.com ~NOTFOUND, MAP raw.githubusercontent.com ~NOTFOUND'],viewport:{width:1360,height:1000}});
  t.after(()=>context.close());
  let remoteRequests=0, blockRequests=0, relationshipReads=0, pageNavigations=0;let blocking=false;const accountId='9876543210987654321',targetId='1234567890123456789',csrf='a'.repeat(64),apiCalls=[];
  const expires=Math.floor(Date.now()/1000)+3600;
  await context.addCookies([{name:'twid',value:`u%3D${accountId}`,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},{name:'ct0',value:csrf,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},{name:'auth_token',value:'synthetic-isolated-cookie',domain:'.x.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires}]);
  await context.route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.href===OFFICIAL_SUBSCRIPTION_URL){
      assert.equal(request.method(),'GET');const headers=await request.allHeaders();
      assert.equal(headers.authorization,undefined);assert.equal(headers['x-csrf-token'],undefined);assert.equal(headers.cookie,undefined);
      return route.fulfill({json:OFFICIAL_SEED});
    }
    if(url.origin==='https://x.com'&&[VIEWER_PATH,REST_PATH,'/i/api/1.1/blocks/create.json'].includes(url.pathname)){
      const headers=await request.allHeaders();
      assert.equal(headers['x-csrf-token'],csrf);
      // Routing intercepts before Chromium attaches Cookie. A separate loopback
      // transport test observes cookies at the server; do not infer that here.
      assert.ok(request.serviceWorker(),'API calls must originate in the extension worker');
      apiCalls.push({method:request.method(),origin:url.origin,path:url.pathname});
      if(url.pathname===VIEWER_PATH){
        assert.equal(request.method(),'GET');assert.deepEqual([...url.searchParams.keys()].sort(),['features','fieldToggles','variables']);
        assert.deepEqual(JSON.parse(url.searchParams.get('variables')),{withCommunitiesMemberships:false});
        assert.deepEqual(JSON.parse(url.searchParams.get('features')),VIEWER_FEATURES);
        assert.deepEqual(JSON.parse(url.searchParams.get('fieldToggles')),{withAuxiliaryUserLabels:true,isDelegate:false});
        return route.fulfill({json:graphViewer(accountId,'fixture_owner')});
      }
      if(url.pathname===REST_PATH){
        assert.equal(request.method(),'GET');assert.equal(JSON.parse(url.searchParams.get('variables')).userId,targetId);relationshipReads++;
        return route.fulfill({json:graphUser(targetId,'fixture_target',blocking)});
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
    async function waitForState(predicate,timeout=10000) {
      const deadline=Date.now()+timeout;
      do {const result=await send('GET_STATE');assert.equal(result.ok,true);if(predicate(result.state))return result.state;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
      assert.fail('The acknowledged encrypted state did not reach the expected condition.');
    }
    const fresh=(await send('GET_STATE')).state;
    async function assertEncryptedStorage() {
      const shape=await worker.evaluate(async()=>{
        const local=await chrome.storage.local.get(null);
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gab-encrypted-state',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        try{return await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readonly'),store=tx.objectStore('vault');let key,envelope;store.get('key').onsuccess=event=>{key=event.target.result;};store.get('state').onsuccess=event=>{envelope=event.target.result;};tx.oncomplete=()=>resolve({local,keyExtractable:key?.extractable,keyAlgorithm:key?.algorithm?.name,envelopeKeys:Object.keys(envelope||{}).sort(),ciphertextBytes:envelope?.ciphertext?.byteLength,format:envelope?.format});tx.onerror=()=>reject(tx.error);});}finally{db.close();}
      });
      assert.deepEqual(Object.keys(shape.local),['gabStateRevision']);assert.ok(Number.isSafeInteger(shape.local.gabStateRevision));
      assert.equal(shape.keyExtractable,false);assert.equal(shape.keyAlgorithm,'AES-GCM');
      assert.deepEqual(shape.envelopeKeys,['ciphertext','format','iv','revision']);assert.ok(shape.ciphertextBytes>16);assert.equal(shape.format,'gab-state/aes-gcm-v1');
    }
    await assertEncryptedStorage();
    const official=fresh.subscriptions.find(sub=>sub.url===OFFICIAL_SUBSCRIPTION_URL);
    assert.ok(official?.enabled);assert.equal(fresh.entries.length,OFFICIAL_SEED.entries.length);assert.equal(fresh.settings.autoBlock,false);assert.equal(blockRequests,0);
    // This fixture exercises private import/removal independently. The separate
    // default-subscription fixture tests the two-action fresh-user workflow.
    assert.equal((await send('REMOVE_SUBSCRIPTION',{id:official.id})).ok,true);
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();
    // Synthetic data only: tests never read a maintainer's private review file.
    await page.locator('#import-text').fill(Array.from({length:523},(_,i)=>`@imported_${i}`).join('\n'));
    await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden,null,{timeout:10000});
    let state=(await send('GET_STATE')).state;assert.equal(state.entries.length,523);assert.ok(state.entries.every(e=>e.status==='approved'));assert.equal(state.queue.length,0,'Unbound imports are enabled locally without an execution account');
    assert.equal((await send('EXPORT',{kind:'public'})).ok,false);assert.equal(await page.locator('#export-public').count(),0);
    for(const language of ['en','ja','zh']){await page.locator('#language').selectOption(language);await page.waitForFunction(lang=>document.documentElement.lang===(lang==='zh'?'zh-CN':lang),language);assert.equal((await send('GET_STATE')).state.settings.language,language);}
    await page.locator('[data-panel="overview"]').click();await page.screenshot({path:path.join(outputs,'guga-blocker-preview.png'),fullPage:true});
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();await page.locator('#import-text').fill('@fixture_target');await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden);
    await page.locator('#search').fill('fixture_target');
    await page.locator('#status-filter').selectOption('all');
    await page.locator('[data-edit-handle="fixture_target"]').click();await page.locator('#edit-reason').fill('Fixture reason');await page.locator('#edit-evidence').fill('https://x.com/fixture_target/status/1');await page.locator('#entry-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#entry-dialog').open);
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='fixture_target').reason,'Fixture reason');
    await page.locator('[data-edit-handle="fixture_target"]').click();await page.locator('#edit-id').fill('1234567890123456789');await page.locator('#entry-form button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#entry-dialog').open);
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='fixture_target').id,'1234567890123456789');
    await page.locator('[data-select-handle="fixture_target"]').check();await page.locator('#pending-selected').click();await page.waitForFunction(()=>document.querySelector('#selection-bar').hidden);
    assert.equal((await send('GET_STATE')).state.entries.find(e=>e.handle==='fixture_target').status,'pending','A user can disable an imported local row');
    const downloadEvent=page.waitForEvent('download');await page.locator('#export-kind').selectOption('private');await page.locator('#export-list').click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'guga-private-backup.json');
    await page.bringToFront();await page.locator('[data-panel="settings"]').click();await page.locator('#bind-account').click();
    await page.waitForFunction(()=>document.querySelector('#bound-account').textContent.includes('fixture_owner'));
    assert.equal((await send('GET_STATE')).state.settings.accountId,accountId);
    const beforeQueuePages=context.pages().length;
    await page.locator('#auto-block').check();
    state=await waitForState(value=>value.settings.autoBlock&&value.queue.length===523);assert.equal(state.queue.length,523);assert.ok(state.queue.every(job=>job.status==='needs_id'));assert.equal(blockRequests,0);
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();
    await page.locator('#import-text').fill(JSON.stringify({entries:[{handle:'fixture_target',id:targetId,status:'pending'}]}));
    await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden);
    for(let i=0;i<200;i++){state=(await send('GET_STATE')).state;const job=state.queue.find(j=>j.handle==='fixture_target');if(['done','failed','uncertain'].includes(job?.status))break;await new Promise(resolve=>setTimeout(resolve,250));}
    assert.equal(state.queue.find(j=>j.handle==='fixture_target')?.status,'done',JSON.stringify(state.queue));assert.ok(state.nativeBlocked['id:'+accountId]['id:1234567890123456789']);assert.equal(state.entries.find(e=>e.handle==='fixture_target').id,'1234567890123456789');assert.equal(state.entries.find(e=>e.handle==='fixture_target').status,'approved');assert.equal(state.queue.length,524);assert.equal(blockRequests,1);assert.equal(relationshipReads,2,'Preflight and independent API readback are required');assert.equal(context.pages().length,beforeQueuePages,'API execution must not create a worker tab');assert.equal(pageNavigations,0);
    assert.deepEqual(apiCalls,[
      {method:'GET',origin:'https://x.com',path:VIEWER_PATH},
      {method:'GET',origin:'https://x.com',path:REST_PATH},
      {method:'POST',origin:'https://x.com',path:'/i/api/1.1/blocks/create.json'},
      {method:'GET',origin:'https://x.com',path:REST_PATH}
    ],'Binding and execution must use the current GraphQL reads around one numeric POST');
    await page.locator('[data-panel="overview"]').click();await page.locator('#queue-pause').click();await waitForState(value=>value.paused);await page.reload();assert.equal((await send('GET_STATE')).state.paused,true);
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
    await page.waitForFunction(()=>!document.querySelector('#bind-account').hasAttribute('aria-busy'));
    await page.waitForFunction(()=>document.querySelector('#bound-account').textContent.includes('fixture_owner'));
    await page.locator('[data-panel="library"]').click();await page.locator('#show-import').click();
    await page.locator('#import-text').fill('@popup_draft');
    await page.waitForFunction(async()=>JSON.stringify(await chrome.storage.session.get(null)).includes('@popup_draft'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#import-text')?.value==='@popup_draft');
    assert.equal(await page.locator('#panel-library').isVisible(),true);
    await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#import-card').hidden);
    state=(await send('GET_STATE')).state;assert.equal(state.entries.find(e=>e.handle==='popup_draft')?.status,'approved');assert.equal(state.settings.autoBlock,false);assert.equal(state.paused,true);assert.equal(state.queue.find(job=>job.handle==='popup_draft').status,'needs_id');assert.equal(blockRequests,1,'Import does not enable the master switch or resume paused execution');
    await assertEncryptedStorage();
    const popupDownload=page.waitForEvent('download');await page.locator('#export-list').click();assert.equal((await popupDownload).suggestedFilename(),'guga-private-backup.json');
    await page.locator('[data-panel="subscriptions"]').click();await page.locator('#sub-name').fill('Draft subscription');await page.locator('#sub-url').fill('https://raw.githubusercontent.com/fixture/repo/main/list.json');
    await page.waitForFunction(async()=>JSON.stringify(await chrome.storage.session.get(null)).includes('Draft subscription'));
    await page.reload();await page.waitForFunction(()=>document.querySelector('#sub-name')?.value==='Draft subscription');assert.equal(await page.locator('#panel-subscriptions').isVisible(),true);
    await page.locator('[data-panel="settings"]').click();await page.screenshot({path:path.join(outputs,`guga-popup-${version}-fixture.png`)});
    assert.equal(context.pages().length,pageCount,'Management must not open another tab/window');

    // A real X content-script world can read only the filtering projection,
    // never the encrypted library's account, queue, IDs, evidence or history.
    const fixtureURL='https://x.com/gab_filter_fixture';
    await context.route(fixtureURL,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main><article id="encrypted-target" data-testid="tweet"><div data-testid="User-Name"><a href="/fixture_target">Fixture</a></div><div data-testid="tweetText">Synthetic content</div></article></main></body></html>'}));
    const contentPage=await context.newPage(),client=await context.newCDPSession(contentPage),worlds=[];
    client.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await client.send('Runtime.enable');
    let originalEnvelope;
    try {
      await contentPage.goto(fixtureURL);await contentPage.waitForSelector('#encrypted-target.gab-filtered');
      let contentWorld;
      for(const world of worlds){
        if(world.auxData?.isDefault)continue;
        const probe=await client.send('Runtime.evaluate',{expression:'globalThis.chrome?.runtime?.id',contextId:world.id,returnByValue:true}).catch(()=>null);
        if(probe?.result?.value===id){contentWorld=world.id;break;}
      }
      assert.ok(contentWorld,'The actual extension content script runs in its isolated world');
      const contentCall=async type=>(await client.send('Runtime.evaluate',{expression:`chrome.runtime.sendMessage(${JSON.stringify({type})})`,contextId:contentWorld,awaitPromise:true,returnByValue:true})).result.value;
      const denied=await contentCall('GET_STATE');assert.equal(denied.ok,false);assert.equal(denied.state,undefined);
      const projected=await contentCall('GET_FILTER_STATE');assert.equal(projected.ok,true);assert.deepEqual(Object.keys(projected.filterState).sort(),['handles','hideContent','language']);
      assert.ok(projected.filterState.handles.includes('fixture_target'));
      for(const privateValue of [accountId,targetId,'Fixture reason','fixture_owner'])assert.equal(JSON.stringify(projected).includes(privateValue),false,`Filter projection must not disclose ${privateValue}`);
      assert.equal((await send('SAVE_SETTINGS',{settings:{hideContent:false}})).ok,true);
      await contentPage.waitForFunction(()=>!document.querySelector('#encrypted-target').classList.contains('gab-filtered'));
      assert.equal((await send('SAVE_SETTINGS',{settings:{hideContent:true}})).ok,true);
      await contentPage.waitForSelector('#encrypted-target.gab-filtered');
      await assertEncryptedStorage();

      // Corrupt only this disposable fixture's ciphertext. The UI must retain
      // its last successful view and show an error; a fresh page must not claim
      // that a failed read means an empty library. Restore the ciphertext below.
      const countBefore=await page.locator('#stat-approved').textContent();
      originalEnvelope=await worker.evaluate(async()=>{
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gab-encrypted-state',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        try{return await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite'),store=tx.objectStore('vault');let backup;store.get('state').onsuccess=event=>{const envelope=event.target.result;backup={...envelope,iv:[...envelope.iv],ciphertext:[...new Uint8Array(envelope.ciphertext)]};const damaged=new Uint8Array(envelope.ciphertext.slice(0));damaged[0]^=1;store.put({...envelope,ciphertext:damaged.buffer},'state');};tx.oncomplete=()=>resolve(backup);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
      });
      await worker.evaluate(async()=>{const {gabStateRevision}=await chrome.storage.local.get('gabStateRevision');await chrome.storage.local.set({gabStateRevision:gabStateRevision+1});});
      await page.waitForFunction(()=>document.querySelector('#state-read-status')?.getAttribute('role')==='alert');
      assert.equal(await page.locator('#state-read-status').isVisible(),true);assert.equal(await page.locator('#stat-approved').textContent(),countBefore);
      assert.equal(await contentPage.locator('#encrypted-target').evaluate(node=>node.classList.contains('gab-filtered')),true);
      const unreadable=await send('GET_STATE');assert.equal(unreadable.ok,false);assert.equal(unreadable.code,'STATE_STORAGE');
      await page.reload();await page.waitForFunction(()=>document.querySelector('#state-read-status')?.getAttribute('role')==='alert');
      assert.equal(await page.locator('.panel:visible').count(),0,'An unreadable first load must not display an empty library');
      assert.equal((await contentCall('GET_FILTER_STATE')).ok,false);
      assert.equal(await contentPage.locator('#encrypted-target').evaluate(node=>node.classList.contains('gab-filtered')),true);
    } finally {
      if(originalEnvelope)await worker.evaluate(async backup=>{
        const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gab-encrypted-state',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        try{await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite');tx.objectStore('vault').put({...backup,iv:new Uint8Array(backup.iv),ciphertext:new Uint8Array(backup.ciphertext).buffer},'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
        await chrome.storage.local.set({gabStateRevision:backup.revision});
      },originalEnvelope);
      await contentPage.close();
    }
    await page.waitForFunction(()=>document.querySelector('#state-read-status')?.hidden===true);
    await assertEncryptedStorage();
    assert.deepEqual(errors,[]);assert.equal(remoteRequests,0);
    await fs.writeFile(path.join(outputs,'integration-result.json'),JSON.stringify({passed:true,version,syntheticEntries:523,locales:['zh','en','ja'],nativeBlock:'production API executor with intercepted X GraphQL reads, legacy block POST responses and synthetic cookies; no live account actions',realExtensionLoaded:true,workerApiRequests:true,noExecutionTab:true,relationshipReadback:true,relationshipReads,graphQLReads:true,popupManagement:true,popupDraftRecovery:true,blockRequests,pageErrors:errors,unexpectedRemoteRequests:remoteRequests},null,2));
  }catch(error){console.error(JSON.stringify({errors,toast:await page.locator('#toast').textContent().catch(()=>''),pages:await Promise.all(context.pages().map(async p=>({url:p.url(),text:(await p.locator('body').innerText()).slice(-500)})))},null,2));await page.screenshot({path:path.join(work,'integration-failure.png'),fullPage:true});throw error;}finally{await context.close();}
});
