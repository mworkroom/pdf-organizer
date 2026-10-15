const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1}),page=await context.newPage();
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
  const button=name=>page.getByRole('button',{name,exact:true}),report=async()=>JSON.parse(await page.locator('#qaReport').textContent());
  const wait=(fn,arg)=>page.waitForFunction(fn,arg),records=async()=>(await report()).maintenance;
  const openMaintenance=async()=>{await button('Pattern Library').click();if(!await page.locator('#libraryMaintenance').getAttribute('open'))await page.locator('#libraryMaintenance > summary').click();};
  const idle=()=>wait(()=>!document.getElementById('startAnalysisButton').disabled);
  const analyzedCount=()=>wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).maintenance.filter(p=>p.present&&p.analysis).length===1);
  const choose=async(oldId,newId)=>{await page.getByRole('combobox',{name:'Previous pattern',exact:true}).selectOption(oldId);await page.getByRole('combobox',{name:'Current file candidate',exact:true}).selectOption(newId);};
  const check=async()=>{await button('Verify candidate hash').click();await idle();};
  const consent=()=>page.getByRole('checkbox',{name:'I have checked that the previous pattern and the selected candidate are the same pattern.',exact:true}).check();
  try{
    let releaseImport;const importGate=new Promise(resolve=>releaseImport=resolve);
    await page.route('**/vendor/pdfjs/build/pdf.min.mjs',route=>importGate.then(()=>route.continue()),{times:1});
    await page.goto('http://127.0.0.1:8766/?qa=1');await button('Prepare analysis and recovery samples').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===7);
    const initial=await records(),oldLegacy=initial.find(p=>p.path==='Legacy.pdf'),preserved=initial.find(p=>p.path==='Preserved.pdf');assert.equal((await report()).pdfStats.reads,0);assert.equal((await report()).maintenanceHashReads,0);
    await openMaintenance();await button('Analyze remaining PDFs / resume').click();await button('Pause analysis').click();releaseImport();await idle();assert.match(await page.locator('#maintenanceStatus').innerText(),/Pause analysis/);assert.equal((await records()).filter(p=>p.present&&p.analysis).length,0);
    await button('Pause after analyzing one file').click();await button('Analyze remaining PDFs / resume').click();await idle();await analyzedCount();assert.match(await page.locator('#maintenanceStatus').innerText(),/Pause analysis/);
    await button('Inject metadata save failure').click();await button('Analyze remaining PDFs / resume').click();await idle();assert.match(await page.locator('#maintenanceStatus').innerText(),/Analysis stopped.*save failure/);assert.equal((await records()).filter(p=>p.present&&p.analysis).length,1);
    await button('Clear injected errors').click();await page.reload();await button('Reconnect sample library').click();await openMaintenance();await analyzedCount();
    await button('Analyze remaining PDFs / resume').click();await idle();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).maintenance.filter(p=>p.present&&p.analysis).length===7);
    const analyzed=await records(),mystery=analyzed.find(p=>p.path==='Mystery.pdf'),manual=analyzed.find(p=>p.path==='Manual.pdf'),conflict=analyzed.find(p=>p.path==='Conflict_Shawl.pdf');
    assert.deepEqual(mystery.categories,['sweater']);assert.equal(mystery.source,'pdf-text');assert.equal(mystery.analysis.pages,3);assert.deepEqual(mystery.analysis.matches,['sweater']);
    assert.deepEqual(manual.categories,['unknown']);assert.equal(manual.source,'manual');assert.equal(manual.page,2);assert.equal(manual.sha256.length,64);
    assert.deepEqual(conflict.categories,['shawl']);assert.equal(conflict.analysis.status,'uncertain');assert.deepEqual(conflict.analysis.matches,['cowl']);assert.equal(analyzed.find(p=>p.path==='Blank.pdf').analysis.status,'no-text');assert.equal(analyzed.find(p=>p.path==='Broken.pdf').analysis.status,'error');
    const beforeRetry=(await report()).pdfStats.reads;await button('Retry failed PDFs').click();await idle();await wait(n=>JSON.parse(document.querySelector('#qaReport').textContent).pdfStats.reads>n,beforeRetry);assert.equal((await records()).find(p=>p.path==='Broken.pdf').analysis.status,'error');
    await button('Create moved samples and duplicate candidates').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===8);
    const moved=await records(),old=moved.find(p=>p.id===preserved.id),renamed=moved.find(p=>p.path==='Moved/Renamed.pdf'),copy=moved.find(p=>p.path==='Moved/Same_Copy.pdf');assert.equal(old.present,false);assert.equal(old.sha256.length,64);assert.ok(copy.present&&renamed.present);
    // Same-size wrong file cannot be linked, even with the explicit acknowledgment.
    await choose(old.id,mystery.id);await check();assert.match(await page.locator('#repairEvidence').innerText(),/mismatch/);await consent();await button('Save link to selected file').click();assert.match(await page.locator('#maintenanceStatus').innerText(),/does not match/);assert.equal((await records()).find(p=>p.id===old.id).present,false);
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).maintenanceHashReads===1);
    await choose(old.id,renamed.id);const beforeCheck=(await report()).maintenanceHashReads;await check();assert.match(await page.locator('#repairEvidence').innerText(),/SHA-256 match/);
    await wait(n=>JSON.parse(document.querySelector('#qaReport').textContent).maintenanceHashReads===n+1,beforeCheck);assert.equal((await records()).find(p=>p.id===old.id).present,false);assert.ok((await records()).find(p=>p.id===copy.id).present);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('#libraryMaintenance').scrollIntoViewIfNeeded();
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fonts:[...document.querySelectorAll('.repair-fields select,.maintenance-actions button,.repair-confirm')].map(el=>parseFloat(getComputedStyle(el).fontSize)),outside:[...document.querySelectorAll('.repair-fields select,.maintenance-actions button')].some(el=>el.getBoundingClientRect().right>innerWidth)}));
      assert.equal(layout.width,layout.scroll);assert.ok(layout.fonts.every(size=>size>=14));assert.equal(layout.outside,false);
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-step5-maintenance-${width}.png`)});
    }
    await consent();await button('Inject metadata save failure').click();await button('Save link to selected file').click();await idle();assert.match(await page.locator('#maintenanceStatus').innerText(),/Relinking failed/);assert.equal((await records()).find(p=>p.id===old.id).present,false);assert.ok((await records()).find(p=>p.id===renamed.id).present);
    await button('Clear injected errors').click();await button('Save link to selected file').click();await idle();await wait(id=>JSON.parse(document.querySelector('#qaReport').textContent).maintenance.find(p=>p.id===id)?.present,old.id);
    const linked=(await records()).find(p=>p.id===old.id);assert.equal(linked.path,'Moved/Renamed.pdf');assert.deepEqual(linked.categories,['cardigan','hat']);assert.equal(linked.page,2);assert.equal(linked.source,'manual');assert.ok((await records()).find(p=>p.id===copy.id).present);
    // Pre-hash legacy data needs explicit manual confirmation; no automatic content-proof claim.
    const legacyCandidate=(await records()).find(p=>p.path==='Legacy_Renamed.pdf'&&p.present);await choose(oldLegacy.id,legacyCandidate.id);await check();assert.match(await page.locator('#repairEvidence').innerText(),/No previous hash/);
    await button('Save link to selected file').click();assert.match(await page.locator('#maintenanceStatus').innerText(),/confirmation checkbox/);await consent();await button('Save link to selected file').click();await idle();await wait(id=>JSON.parse(document.querySelector('#qaReport').textContent).maintenance.find(p=>p.id===id)?.present,oldLegacy.id);
    await button('Refresh library').click();await idle();const stable=await records();assert.equal(stable.find(p=>p.path==='Moved/Renamed.pdf'&&p.present).id,old.id);assert.equal(stable.find(p=>p.path==='Legacy_Renamed.pdf'&&p.present).id,oldLegacy.id);assert.equal(stable.filter(p=>p.present).length,8);
    assert.ok((await report()).pdfStats.maxActive<=1);assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:8766/')||url.startsWith('blob:http://127.0.0.1:8766/')));
    await button('End sample session').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===0);
    console.log(JSON.stringify({result:'PASS',analysis:'first 3 pages, pause/resume, JSON failure, manual preservation, no text, corrupt PDF, conflict',repair:'hash mismatch, ambiguous copies, explicit legacy link, stable IDs, failed save',viewports:[2048,1280],unexpectedErrors:errors.length,externalRequests:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
