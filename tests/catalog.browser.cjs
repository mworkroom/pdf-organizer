// Developer-only integration test: isolated Chrome, disposable OPFS PDFs, UI actions.
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
  const ui=(name)=>page.getByRole('button',{name,exact:true});
  const waitReport=async predicate=>page.waitForFunction(predicate);
  const report=async()=>JSON.parse(await page.locator('#qaReport').textContent());
  const idle=async()=>page.waitForFunction(()=>!document.getElementById('refreshLibraryButton').disabled);
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');
    await ui('Prepare category samples').click();
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.current===100&&r.catalog?.patterns.length===3;});
    const incoming=()=>page.locator('#sortingList .sort-row').first();
    assert.equal(await page.locator('#sortingList .sort-row').count(),100);
    await incoming().getByRole('checkbox',{name:'Hat',exact:true}).check();
    await incoming().getByRole('checkbox',{name:'Scarf',exact:true}).check();
    await incoming().getByRole('button',{name:'Reanalyze filename',exact:true}).click();
    await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).savedSelectedCategories?.join(',')==='hat,scarf');
    await page.reload();await ui('Resume review').click();
    await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===100);
    assert.equal(await incoming().getByRole('checkbox',{name:'Hat',exact:true}).isChecked(),true);
    await ui('Pattern Library').click();
    await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill('Root_Sweater');
    await page.waitForFunction(()=>document.querySelector('#libraryPatternList').dataset.query==='Root_Sweater');
    const root=()=>page.locator('.library-pattern').filter({hasText:'Root_Sweater'});
    await root().getByRole('button',{name:'Edit',exact:true}).click();
    await root().getByRole('checkbox',{name:'Hat',exact:true}).check();await root().getByRole('checkbox',{name:'Scarf',exact:true}).check();
    await ui('Save categories').click();await idle();
    const rootId=(await report()).catalog.patterns.find(p=>p.path==='Root_Sweater.pdf').id;
    await page.locator('#categoryManager > summary').click();
    await page.getByRole('textbox',{name:'Sweater Name',exact:true}).fill('Pullovers');await ui('Sweater Move down').click();await ui('Save category changes').click();await idle();
    assert.equal(await page.locator('.category-name').nth(0).inputValue(),'Cardigan');assert.equal(await page.locator('.category-name').nth(1).inputValue(),'Pullovers');
    await page.getByRole('textbox',{name:'New category name',exact:true}).fill('Accessories Test');await ui('Add category').click();await idle();
    await page.getByRole('textbox',{name:'Accessories Test Inference keywords',exact:true}).fill('pattern');await ui('Save category changes').click();await idle();
    await ui('Reanalyze automatic categories').click();await idle();
    assert.match(await root().innerText(),/Pullovers.*Hat.*Scarf/);
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.catalog?.patterns.find(p=>p.path==='Designer/Pattern_001.pdf')?.categoryIds[0]===r.catalog?.categories.find(c=>c.name==='Accessories Test')?.id;});
    await page.getByRole('combobox',{name:'Scarf Replacement category on deletion',exact:true}).selectOption('shawl');
    page.once('dialog',dialog=>dialog.accept());await ui('Scarf Delete').click();await idle();assert.match(await root().innerText(),/Pullovers.*Hat.*Shawl/);
    // Unsaved library classifications and category names survive other JSON saves.
    await root().getByRole('button',{name:'Edit',exact:true}).click();await root().getByRole('checkbox',{name:'Cowl',exact:true}).check();
    await page.getByRole('textbox',{name:'Pullovers Name',exact:true}).fill('Pullovers Edited');await ui('Save category changes').click();await idle();
    assert.equal(await root().getByRole('checkbox',{name:'Cowl',exact:true}).isChecked(),true);
    await root().getByRole('button',{name:'Cancel changes',exact:true}).click();
    await page.setViewportSize({width:1280,height:1152});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
    assert.equal(await page.getByRole('textbox',{name:'Pullovers Edited Name',exact:true}).evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16),true);
    if(process.env.PDF_ORGANIZER_ARTIFACT_DIR){await page.locator('#categoryManager > summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,'pdf-organizer-step3-categories-1280.png')});}
    await page.setViewportSize({width:2048,height:1152});
    await page.locator('#categoryManager > summary').click();
    await ui('Organize Files').click();
    const secondIncoming=page.locator('#sortingList .sort-row').filter({hasText:'Source file: Designer_Pattern_002.pdf'});
    await secondIncoming.getByRole('checkbox',{name:'Unknown',exact:true}).check();
    await secondIncoming.getByRole('checkbox',{name:'Hat',exact:true}).check();await secondIncoming.getByRole('checkbox',{name:'Shawl',exact:true}).check();
    await ui('Check duplicates').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).checked);
    await ui('Inject metadata save failure').click();await ui('Organize batch').click();
    await page.waitForFunction(()=>document.getElementById('executeStatus').textContent.includes('Run failed')&&!document.getElementById('duplicateCheckButton').disabled);
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return !r.checked&&r.catalog?.patterns.length===3;});
    assert.equal((await report()).sourceCount,200);
    await ui('Clear injected errors').click();await ui('Check duplicates').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).checked);
    await ui('Organize batch').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===0);
    assert.match(await page.locator('#executeStatus').innerText(),/98 moved.*1 exact duplicates deleted/);
    assert.equal((await report()).sourceCount,101);
    await ui('Pattern Library').click();await ui('Reload JSON without browser review').click();await idle();
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.catalog?.patterns.find(p=>p.path==='Root_Sweater.pdf')?.categoryIds.includes('shawl')&&!r.storedVersion;});
    const restored=(await report()).catalog.patterns;assert.equal(restored.find(p=>p.path==='Root_Sweater.pdf').id,rootId);assert.deepEqual(restored.find(p=>p.path==='Designer/Pattern_002.pdf').categoryIds,['hat','shawl']);
    await ui('Inject corrupt metadata').click();await ui('Refresh library').click();await idle();
    assert.match(await page.locator('#catalogStatus').innerText(),/original JSON will not be overwritten/);
    await ui('Clear injected errors').click();await idle();
    await root().getByRole('button',{name:'Edit',exact:true}).click();
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.evaluate(()=>window.scrollTo(0,0));
      const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,inputSize:getComputedStyle(document.querySelector('.category-picker label')).fontSize,buttons:[...document.querySelectorAll('#libraryView button')].filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().top<innerHeight).map(b=>({left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))}));
      assert.equal(layout.scroll,layout.viewport);assert.ok(parseFloat(layout.inputSize)>=14);assert.ok(layout.buttons.every(b=>b.left>=0&&b.right<=width));
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-step3-library-${width}.png`)});
    }
    await ui('Organize Files').click();await ui('Review next 100').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===100);
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
    if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,'pdf-organizer-step3-organize-1280.png')});
    const unexpected=errors.filter(error=>!error.includes('QA metadata save failure'));assert.deepEqual(unexpected,[]);
    await ui('End sample session').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===0);
    console.log(JSON.stringify({result:'PASS',workflow:'categories, manual/bulk preservation, JSON recovery, corruption guard, move failure/success',viewports:[2048,1280],unexpectedErrors:unexpected.length,expectedInjectedErrors:errors.length}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
