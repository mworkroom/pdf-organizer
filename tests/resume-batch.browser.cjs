// Exercise saved-review recovery with disposable OPFS folders, never real files.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
  const button=name=>page.getByRole('button',{name,exact:true});
  const wait=(predicate,arg)=>page.waitForFunction(predicate,arg);
  const row=index=>page.locator('#sortingList .sort-row').nth(index);
  const seed=async count=>{
    await page.getByRole('spinbutton',{name:'QA sample count',exact:true}).fill(String(count));
    await button('Prepare custom samples').click();
    await wait(()=>!document.querySelector('#qaCustomSeed').disabled&&!operationBusy);
    assert.equal(await page.evaluate(()=>downloadFiles.length),Math.min(count,100));
  };
  const saved=()=>wait(()=>document.querySelector('#draftSaveStatus').textContent==='Review saved'&&!operationBusy);
  const resume=async count=>{
    await saved();await page.reload();
    await wait(()=>!document.querySelector('#draftRecovery').classList.contains('hidden'));
    assert.equal(await page.locator('#sortingList .sort-row').count(),0);
    await button('Resume review').click();
    await wait(n=>!operationBusy&&downloadFiles.length===n,count);await saved();
    assert.equal(await page.locator('#sortingList .sort-row').count(),count);
  };
  try{
    await page.goto('http://127.0.0.1:8766/?qa=1');
    await seed(52);
    await row(1).locator('.filename-editor summary').click();
    await row(1).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).fill('Unique_manual_001.pdf');
    await row(1).getByRole('checkbox',{name:'Cardigan',exact:true}).check();
    await row(1).getByRole('checkbox',{name:'texture',exact:true}).check();
    await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).check();
    const patternId=await page.evaluate(()=>downloadFiles[1].patternId);
    await button('Defer batch').click();await saved();
    await page.evaluate(async()=>{batchNumber=2;scheduleDraftSave();await saveReviewDraft();});
    assert.equal(await page.evaluate(()=>deferredDownloadFiles.length),52);
    await resume(52);
    assert.equal(await page.locator('#batchTitle').innerText(),'Batch 2');
    assert.match(await page.locator('#batchSummary').innerText(),/Current: 52 · Queued: 0 · Deferred\/excluded: 0/);
    assert.match(await page.locator('#executeStatus').innerText(),/Opened 52 deferred reviews.*1 file remains excluded/);
    assert.equal(await button('Check duplicates').isEnabled(),true);
    assert.equal(await row(1).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).inputValue(),'Unique_manual_001.pdf');
    assert.equal(await row(1).getByRole('checkbox',{name:'Cardigan',exact:true}).isChecked(),true);
    assert.equal(await row(1).getByRole('checkbox',{name:'texture',exact:true}).isChecked(),true);
    assert.equal(await page.evaluate(()=>downloadFiles[1].patternId),patternId);
    assert.equal(await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).isChecked(),true);
    assert.equal(await page.evaluate(async()=>{const draft=await ReviewDraftStore.load();return draft.files.filter(f=>f.role==='current').length;}),52);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await row(0).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      const controls=await row(0).locator('button,input').evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,font:parseFloat(getComputedStyle(e).fontSize),checkbox:e.type==='checkbox'})));
      assert.ok(controls.every(e=>e.left>=0&&e.right<=width&&(e.checkbox||e.font>=14)),JSON.stringify(controls));
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-resumed-52-${width}.png`)});
    }
    await resume(52); // The new current membership survives another reload.
    await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).uncheck();
    await page.evaluate(()=>{for(const file of downloadFiles)if(!file.attributeIds.length)file.attributeIds=['texture'];renderSortingRows();scheduleDraftSave();});
    await button('Check duplicates').click();await wait(()=>duplicateCheckComplete&&!operationBusy);
    await button('Organize batch').click();await wait(()=>!operationBusy&&!downloadFiles.length);
    assert.match(await page.locator('#executeStatus').innerText(),/Organization complete/);
    assert.equal(await page.evaluate(()=>getAllReviewFiles().length),0);
    assert.equal(await page.evaluate(()=>libraryCatalog.patterns.filter(p=>p.present).length),53);

    // A saved empty current batch prefers its 52 waiting files over 100 deferred.
    await seed(152);await button('Defer batch').click();await saved();await resume(52);
    assert.equal(await page.evaluate(()=>deferredDownloadFiles.length),100);
    assert.equal(await page.evaluate(()=>downloadFiles[0].name),'Designer_Pattern_100.pdf');
    assert.match(await page.locator('#executeStatus').innerText(),/Opened 52 queued reviews/);

    await seed(3);await page.evaluate(async()=>{
      downloadFiles.forEach(file=>file.excluded=true);await deferCurrentBatch();
    });await resume(3);
    assert.equal(await page.evaluate(()=>downloadFiles.every(file=>file.excluded)),true);
    assert.match(await page.locator('#executeStatus').innerText(),/3 files remain excluded/);
    assert.equal(await row(0).getByRole('checkbox',{name:'Exclude from this run',exact:true}).isEnabled(),true);
    await button('End sample session').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',recovery:'52 deferred reviews, repeated reload, saved edits and exclusions, 52 queued preferred over 100 deferred, all-excluded reviews remain editable',organization:'52 actual duplicate checks and moves',viewports:[2048,1280],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
