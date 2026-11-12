import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {OFFICIAL_SUBSCRIPTION_ID,OFFICIAL_SUBSCRIPTION_URL,OFFICIAL_SEED} from '../extension/lib/official-list.js';
import {setLanguage,t as translate} from '../extension/lib/i18n.js';

const require=createRequire(import.meta.url);let playwright;
try{playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{}
const project=path.resolve(import.meta.dirname,'..'),outputs=path.resolve(project,'..');
const VIEWER_PATH='/i/api/graphql/TpQxQtWMTMnIAMPlMGMqNw/Viewer';
const RELATIONSHIP_PATH='/i/api/graphql/mxaYWwt52eAb6OAzYHMVzg/UserByRestId';
const BLOCK_PATH='/i/api/1.1/blocks/create.json';
const user=(id,handle,blocking=false)=>({__typename:'User',rest_id:id,core:{screen_name:handle},relationship_perspectives:{blocking}});

// Actual unpacked product, new disposable profile and synthetic authentication.
// Every allowed request is intercepted; no live X or GitHub operation is used.
test('fresh users receive the official subscription and need only connect plus enable automatic blocking',{
  skip:!playwright&&'Set PLAYWRIGHT_MODULE or install Playwright.',timeout:120000
},async testContext=>{
  const work=path.resolve(project,'../../work');await fs.mkdir(work,{recursive:true});
  const profile=await fs.mkdtemp(path.join(work,'default-subscription-browser-'));
  const extension=path.join(project,'extension');
  const version=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8')).version;
  const context=await playwright.chromium.launchPersistentContext(profile,{
    channel:'chromium',headless:true,timeout:20000,viewport:{width:450,height:580},
    ...(process.env.GAB_CHROMIUM_PATH?{executablePath:process.env.GAB_CHROMIUM_PATH}:{}),
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      '--disable-background-networking','--disable-component-update','--disable-sync','--disable-quic',
      '--host-resolver-rules=MAP * ~NOTFOUND']
  });
  testContext.after(()=>context.close());
  const accountId='9876543210987654321',csrf='a'.repeat(64),target=OFFICIAL_SEED.entries[0];
  const routeErrors=[],pageErrors=[],unexpectedRequests=[],apiCalls=[];
  let githubRequests=0,blockRequests=0,relationshipReads=0,blocking=false;
  await context.route(/https?:\/\//,async route=>{
    const request=route.request(),url=new URL(request.url());
    try {
      if(request.url()===OFFICIAL_SUBSCRIPTION_URL){
        const headers=await request.allHeaders();
        assert.equal(request.method(),'GET');assert.ok(request.serviceWorker());
        for(const key of ['authorization','x-csrf-token','cookie'])assert.equal(Boolean(headers[key]),false,`Public list fetch must omit ${key}`);
        githubRequests++;
        return await route.fulfill({json:OFFICIAL_SEED});
      }
      if(url.origin==='https://x.com'&&[VIEWER_PATH,RELATIONSHIP_PATH,BLOCK_PATH].includes(url.pathname)){
        assert.ok(request.serviceWorker(),'The extension worker must perform API operations without opening an X page.');
        const headers=await request.allHeaders();assert.equal(headers['x-csrf-token'],csrf);
        apiCalls.push({method:request.method(),path:url.pathname});
        if(url.pathname===VIEWER_PATH){
          assert.equal(request.method(),'GET');
          assert.deepEqual(JSON.parse(url.searchParams.get('variables')),{withCommunitiesMemberships:false});
          return await route.fulfill({json:{data:{viewer:{user_results:{result:user(accountId,'fixture_owner')}}}}});
        }
        if(url.pathname===RELATIONSHIP_PATH){
          assert.equal(request.method(),'GET');assert.equal(JSON.parse(url.searchParams.get('variables')).userId,target.id);
          relationshipReads++;
          return await route.fulfill({json:{data:{user:{result:user(target.id,target.handle,blocking)}}}});
        }
        assert.equal(request.method(),'POST');assert.equal(request.postData(),`user_id=${target.id}`);
        blockRequests++;blocking=true;
        return await route.fulfill({json:{id_str:target.id,screen_name:target.handle,blocking:true}});
      }
      // Record only origin/path, never query strings, headers or cookie values.
      unexpectedRequests.push({origin:url.origin,path:url.pathname,method:request.method()});
      await route.abort();
    }catch(error){routeErrors.push(error.message);await route.abort().catch(()=>{});}
  });
  const expires=Math.floor(Date.now()/1000)+3600;
  await context.addCookies([
    {name:'twid',value:`u%3D${accountId}`,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},
    {name:'ct0',value:csrf,domain:'.x.com',path:'/',secure:true,sameSite:'Lax',expires},
    {name:'auth_token',value:'synthetic-default-subscription-fixture',domain:'.x.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires}
  ]);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host,page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
  const send=(type,payload={})=>page.evaluate(({type,payload})=>chrome.runtime.sendMessage({type,...payload}),{type,payload});
  const read=async()=>{const result=await send('GET_STATE');assert.equal(result.ok,true);return result.state;};
  async function waitForState(predicate,timeout=10000){
    const deadline=Date.now()+timeout;let state;
    do {state=await read();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,250));}while(Date.now()<deadline);
    assert.fail(`State did not settle; first queue status: ${state.queue[0]?.status||'empty'}; errors: ${routeErrors.join('; ')}`);
  }
  async function noOverflow(label){
    const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewportWidth:innerWidth,viewportHeight:innerHeight}));
    assert.ok(layout.width<=layout.viewportWidth+1,`${label}: horizontal overflow`);
    assert.ok(layout.height<=layout.viewportHeight+1,`${label}: page should scroll inside popup`);
  }
  try {
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForFunction(()=>document.querySelector('#stat-approved')?.textContent==='523');
    let state=await read();
    assert.equal(state.entries.length,523);assert.equal(state.entries.filter(entry=>entry.source==='local').length,0);
    assert.equal(state.subscriptions.length,1);assert.equal(state.subscriptions[0].id,OFFICIAL_SUBSCRIPTION_ID);assert.equal(state.subscriptions[0].url,OFFICIAL_SUBSCRIPTION_URL);assert.equal(state.subscriptions[0].enabled,true);
    assert.equal(state.settings.accountId,'');assert.equal(state.settings.autoBlock,false);assert.equal(state.paused,true);assert.equal(state.queue.length,0);assert.equal(apiCalls.length,0);
    const locales=[];
    for(const language of ['en','ja','zh']){
      await page.locator('#language').selectOption(language);
      await page.waitForFunction(value=>document.documentElement.lang===(value==='zh'?'zh-CN':value),language);
      setLanguage(language);
      await page.locator('[data-panel="overview"]').click();
      assert.equal(await page.locator('#included-list-note').textContent(),translate('includedListHelp'));
      assert.equal(await page.locator('#protection-desc').textContent(),translate('officialReadyDesc'));
      assert.equal(await page.locator('#stat-approved').textContent(),'523');await noOverflow(`${language}/overview`);
      await page.locator('[data-panel="subscriptions"]').click();
      assert.equal(await page.locator('#subscription-list h3').textContent(),translate('officialList'));
      assert.equal(await page.locator('#subscription-list .badge').textContent(),translate('officialReadOnly'));
      assert.ok((await page.locator('#subscription-list').textContent()).includes('523'));await noOverflow(`${language}/subscriptions`);
      await page.locator('[data-panel="settings"]').click();await noOverflow(`${language}/settings`);locales.push(language);
    }
    assert.equal(blockRequests,0);assert.equal((await read()).queue.length,0);
    await page.locator('[data-panel="overview"]').click();
    await page.screenshot({path:path.join(outputs,'guga-default-0.2.3-fixture.png')});
    const pageCount=context.pages().length;
    // No import, manual subscription setup, or manual queue-start action.
    await page.locator('[data-panel="settings"]').click();await page.locator('#bind-account').click();
    await page.waitForFunction(()=>document.querySelector('#bound-account')?.textContent.includes('fixture_owner'));
    state=await read();assert.equal(state.settings.accountId,accountId);assert.equal(state.settings.autoBlock,false);assert.equal(state.paused,true);assert.equal(state.queue.length,0);assert.equal(blockRequests,0);
    await page.locator('#auto-block').check();
    await waitForState(state=>state.settings.autoBlock&&state.queue.length===523);
    state=await read();assert.ok(state.queue.every(job=>job.status==='pending'&&job.userId));assert.equal(state.entries.filter(entry=>entry.source==='local').length,0);
    await waitForState(state=>state.queue[0]?.status==='done',55000);
    // Stop immediately after readback, well before the next 30-second interval.
    await page.locator('#auto-block').uncheck();
    await waitForState(state=>!state.settings.autoBlock&&state.paused);
    state=await read();assert.equal(state.queue.filter(job=>job.status==='done').length,1);assert.equal(state.queue.filter(job=>job.status==='pending').length,522);
    assert.ok(state.nativeBlocked[`id:${accountId}`][`id:${target.id}`]);assert.equal(blockRequests,1);assert.equal(relationshipReads,2);assert.ok(githubRequests>=1);
    assert.deepEqual(apiCalls,[{method:'GET',path:VIEWER_PATH},{method:'GET',path:RELATIONSHIP_PATH},{method:'POST',path:BLOCK_PATH},{method:'GET',path:RELATIONSHIP_PATH}]);
    assert.equal(context.pages().length,pageCount);assert.ok(context.pages().every(candidate=>!/^https?:/.test(candidate.url())));
    await page.locator('[data-panel="subscriptions"]').click();await page.locator(`[data-remove-subscription="${OFFICIAL_SUBSCRIPTION_ID}"]`).click();
    await waitForState(state=>state.subscriptions.length===0);
    await page.reload();await page.waitForSelector('#language');await page.locator('[data-panel="overview"]').click();
    await page.waitForFunction(expected=>document.querySelector('#included-list-note')?.textContent===expected,translate('chooseListHelp'));state=await read();
    assert.equal(state.subscriptions.length,0);assert.equal(state.entries.length,0);assert.equal(state.settings.autoBlock,false);assert.equal(state.paused,true);
    assert.equal(state.queue.filter(job=>job.status==='done').length,1);assert.equal(state.queue.filter(job=>job.status==='pending').length,0);assert.equal(blockRequests,1);
    assert.equal(await page.locator('#included-list-note').textContent(),translate('chooseListHelp'));
    assert.deepEqual(routeErrors,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpectedRequests,[]);
    await fs.writeFile(path.join(outputs,'guga-default-0.2.3-fixture.json'),JSON.stringify({
      passed:true,version,realUnpackedExtension:true,freshDisposableProfile:true,seededEntries:523,initialLocalEntries:0,
      initialQueueLength:0,initialAutomaticBlocking:false,locales,popupViewport:{width:450,height:580},overflow:false,
      requiredSetupActions:['connect X','enable automatic blocking'],automaticQueueLength:523,
      confirmedMockBlocks:1,pendingBeforePause:522,relationshipReads,githubRequests,
      githubInterceptContainsCredentials:false,githubWriteRequests:0,noExecutionTabs:true,
      removedSubscriptionRemainsRemovedAfterReload:true,unexpectedRequests:0,pageErrors:[],
      boundary:'All X and GitHub requests were intercepted with synthetic cookies and packaged public data. No live X account action or live GitHub request was used. Cookie transport is covered separately.'
    },null,2));
  }catch(error){
    await page.screenshot({path:path.join(work,'default-subscription-failure.png')}).catch(()=>{});
    console.error(JSON.stringify({pageErrors,routeErrors,unexpectedRequests,githubRequests,blockRequests,relationshipReads}));
    throw error;
  }
});
