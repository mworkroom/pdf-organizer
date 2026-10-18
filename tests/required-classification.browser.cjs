// Isolated Chrome + disposable OPFS samples. No real pattern folders are used.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  const button=name=>page.getByRole('button',{name,exact:true}),wait=(fn,arg)=>page.waitForFunction(fn,arg);
  const row=i=>page.locator('#sortingList .sort-row').nth(i),categories=i=>row(i).locator('[data-review-field="categories"]'),attributes=i=>row(i).locator('[data-review-field="attributes"]');
  const saved=()=>wait(()=>!operationBusy&&document.querySelector('#draftSaveStatus').textContent==='Review saved');
  const seed=async count=>{
    await page.getByRole('spinbutton',{name:'QA sample count',exact:true}).fill(String(count));await button('Prepare custom samples').click();
    await wait(()=>!document.querySelector('#qaCustomSeed').disabled&&!operationBusy);
  };
  const assertBlocked=async name=>{
    const before=await page.evaluate(()=>({count:getAllReviewFiles().length,reads:checkProgress.reads,revision:libraryCatalog.revision}));
    await button(name).click();await wait(()=>document.querySelector('#executeStatus').textContent.startsWith('Complete the required details'));
    assert.deepEqual(await page.evaluate(()=>({count:getAllReviewFiles().length,reads:checkProgress.reads,revision:libraryCatalog.revision})),before);
  };
  try{
    await page.goto('http://127.0.0.1:8766/?qa=1');assert.equal(await page.title(),'PDF Organizer');
    await seed(3);
    await row(1).locator('.filename-editor summary').click();
    await row(1).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).fill('Unique_001.pdf');
    await categories(0).getByRole('checkbox',{name:'Unknown',exact:true}).uncheck();
    await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).check();
    assert.deepEqual(await page.evaluate(()=>getMissingReviewDetails(downloadFiles[0])),['Categories','Attributes']);
    await assertBlocked('Check duplicates');
    assert.equal(await categories(0).getAttribute('aria-invalid'),'true');assert.equal(await attributes(0).getAttribute('aria-invalid'),'true');
    assert.equal(await attributes(1).getAttribute('aria-invalid'),'true');assert.equal(await row(2).getAttribute('class'),'sort-row excluded');
    await wait(()=>document.activeElement===downloadFiles[0].rowElement.querySelector('[data-review-field="categories"] input'));
    assert.equal(await categories(0).getByText('Select at least one category.',{exact:true}).isVisible(),true);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await row(0).scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      assert.ok(await row(0).locator('.classification-error').evaluateAll(nodes=>nodes.every(e=>parseFloat(getComputedStyle(e).fontSize)>=14)));
      assert.ok(await row(0).locator('input,button').evaluateAll(nodes=>nodes.filter(e=>e.getBoundingClientRect().width).every(e=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth)));
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-required-classification-${width}.png`)});
    }
    await assertBlocked('Organize batch');
    await saved();await page.reload();await button('Resume review').click();await wait(()=>!operationBusy&&downloadFiles.length===3);
    assert.equal(await categories(0).locator('input:checked').count(),0); // No silent Unknown fallback on resume.
    assert.equal(await attributes(0).locator('input:checked').count(),0);
    await attributes(0).getByRole('checkbox',{name:'texture',exact:true}).check();
    await attributes(1).getByRole('checkbox',{name:'stockinette',exact:true}).check();
    await assertBlocked('Check duplicates'); // Attributes alone cannot satisfy Categories.
    await categories(0).getByRole('checkbox',{name:'Cardigan',exact:true}).check();
    await categories(0).getByRole('checkbox',{name:'Shawl',exact:true}).check();
    assert.equal(await categories(0).getAttribute('aria-invalid'),null);
    await attributes(0).getByRole('checkbox',{name:'stranded',exact:true}).check();
    await button('Check duplicates').click();await wait(()=>duplicateCheckComplete&&!operationBusy);
    // Revalidate at the second action even if duplicate checking already passed.
    await attributes(1).getByRole('checkbox',{name:'stockinette',exact:true}).uncheck();
    await assertBlocked('Organize batch');
    await wait(()=>document.activeElement===downloadFiles[1].rowElement.querySelector('[data-review-field="attributes"] input'));
    await attributes(1).getByRole('checkbox',{name:'stockinette',exact:true}).check();
    // Removing the category after checking also blocks organization.
    await categories(1).getByRole('checkbox',{name:'Unknown',exact:true}).uncheck();await assertBlocked('Organize batch');
    await categories(1).getByRole('checkbox',{name:'Unknown',exact:true}).check();
    await button('Organize batch').click();await wait(()=>!operationBusy&&!downloadFiles.length);
    assert.match(await page.locator('#executeStatus').innerText(),/Organization complete/);
    assert.equal(await page.evaluate(()=>deferredDownloadFiles.length),1);
    const moved=await page.evaluate(()=>libraryCatalog.patterns.find(p=>p.path==='Designer/Pattern_000.pdf'));
    assert.deepEqual(moved.categoryIds,['cardigan','shawl']);assert.deepEqual(moved.attributeIds,['stranded','texture']);

    // The next batch remains accessible; it must be classified before processing.
    await seed(101);await page.evaluate(()=>{for(const file of downloadFiles)file.excluded=true;renderSortingRows();});
    await button('Defer batch').click();await button('Review next 1').click();await wait(()=>!operationBusy&&downloadFiles.length===1);
    await assertBlocked('Check duplicates');assert.match(await row(0).locator('.row-status').innerText(),/Required: Attributes/);
    assert.equal(await page.evaluate(()=>getIncompleteFiles().length),1); // Queued/deferred work does not enter current validation.
    await button('End sample session').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',workflow:'both action gates, category-only and attribute-only failures, post-check removal, multiple choices, exclusion, empty-category autosave/recovery, actual moves, next small batch',viewports:[2048,1280],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
