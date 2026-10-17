// Disposable OPFS samples in an isolated Chrome context only.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1});
  await context.addInitScript(()=>{window.qaNativeConfirm=window.confirm.bind(window);});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  const button=name=>page.getByRole('button',{name,exact:true});
  const wait=(fn,arg)=>page.waitForFunction(fn,arg),idle=()=>wait(()=>!document.querySelector('#refreshLibraryButton').disabled);
  const row=index=>page.locator('#sortingList .sort-row').nth(index);
  const attributes=scope=>scope.locator('.attribute-picker');
  const filter=()=>page.locator('#libraryAttributeFilter');
  const search=async text=>{await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill(text);await wait(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const confirm=async(name,accept)=>{const dialog=page.waitForEvent('dialog'),click=button(name).click();const opened=await dialog,message=opened.message();if(accept)await opened.accept();else await opened.dismiss();await click;return message;};
  const snapshot=()=>page.evaluate(()=>structuredClone(libraryCatalog));
  const saved=()=>page.evaluate(async()=>JSON.parse(await (await (await libraryDirectoryHandle.getFileHandle(CATALOG_FILE_NAME)).getFile()).text()));
  const capture=async name=>{if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,name)});};
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');assert.equal(await page.title(),'PDF Organizer');
    await button('Prepare 200 samples').click();await wait(()=>document.querySelectorAll('#sortingList .sort-row').length===100);
    assert.equal(await attributes(row(0)).getByRole('checkbox').count(),3);
    assert.deepEqual(await attributes(row(0)).locator('label span').allTextContents(),['stockinette','stranded','texture']);
    assert.equal(await attributes(row(0)).locator('input:checked').count(),0);
    await row(0).getByRole('checkbox',{name:'Cardigan',exact:true}).check();
    await attributes(row(0)).getByRole('checkbox',{name:'stranded',exact:true}).check();
    await attributes(row(0)).getByRole('checkbox',{name:'texture',exact:true}).check();
    await attributes(row(1)).getByRole('checkbox',{name:'stockinette',exact:true}).check();
    await row(1).getByRole('button',{name:'Reanalyze filename',exact:true}).click();
    assert.equal(await attributes(row(1)).getByRole('checkbox',{name:'stockinette',exact:true}).isChecked(),true);
    await wait(()=>document.querySelector('#draftSaveStatus').textContent==='Review saved');
    await page.reload();await button('Resume review').click();await wait(()=>document.querySelectorAll('#sortingList .sort-row').length===100);
    assert.equal(await attributes(row(0)).getByRole('checkbox',{name:'stranded',exact:true}).isChecked(),true);
    assert.equal(await attributes(row(0)).getByRole('checkbox',{name:'texture',exact:true}).isChecked(),true);
    assert.equal(await attributes(row(1)).getByRole('checkbox',{name:'stockinette',exact:true}).isChecked(),true);
    await row(1).getByRole('checkbox',{name:'Exclude from this run',exact:true}).check();assert.equal(await attributes(row(1)).getByRole('checkbox',{name:'stockinette',exact:true}).isEnabled(),false);
    await row(1).getByRole('checkbox',{name:'Exclude from this run',exact:true}).uncheck();
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await row(0).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      const layout=await row(0).evaluate(el=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:el.getBoundingClientRect().height,fonts:[...el.querySelectorAll('label')].map(label=>parseFloat(getComputedStyle(label).fontSize))}));
      assert.equal(layout.width,layout.scroll);assert.ok(layout.height<1120);assert.ok(layout.fonts.every(size=>size>=14));await capture(`pdf-organizer-attributes-review-${width}.png`);
    }
    // Move one incoming PDF; its attributes must reach the durable library JSON.
    const incomingId=await page.evaluate(()=>downloadFiles[0].patternId);
    await page.evaluate(()=>{for(const file of downloadFiles.slice(1))file.excluded=true;renderSortingRows();scheduleDraftSave();});
    await button('Check duplicates').click();await wait(()=>duplicateCheckComplete&&!operationBusy);await button('Organize batch').click();await wait(()=>!operationBusy&&!downloadFiles.length);
    assert.deepEqual((await saved()).patterns.find(p=>p.id===incomingId).attributeIds,['stranded','texture']);
    await button('Pattern Library').click();await search('Pattern_000');
    const card=()=>page.locator('.library-pattern').first();await card().getByRole('button',{name:'Edit',exact:true}).click();
    await attributes(card()).getByRole('checkbox',{name:'stockinette',exact:true}).check();
    assert.equal(await attributes(card()).getByRole('checkbox',{name:'stockinette',exact:true}).isChecked(),true);
    assert.deepEqual((await saved()).patterns.find(p=>p.id===incomingId).attributeIds,['stranded','texture']);
    await button('Refresh library').click();await idle();assert.match(await page.locator('#catalogStatus').innerText(),/Save or cancel.*attribute/);
    await search('no such file');await search('Pattern_000');
    assert.equal(await attributes(card()).getByRole('checkbox',{name:'stockinette',exact:true}).isChecked(),true);
    await button('Save changes').click();await idle();
    assert.deepEqual((await saved()).patterns.find(p=>p.id===incomingId).attributeIds,['stockinette','stranded','texture']);
    await card().getByRole('button',{name:'Edit',exact:true}).click();
    for(const name of ['stockinette','stranded','texture'])await attributes(card()).getByRole('checkbox',{name,exact:true}).uncheck();
    await button('Save changes').click();await idle();
    const cleared=(await saved()).patterns.find(p=>p.id===incomingId);assert.deepEqual(cleared.attributeIds,[]);assert.deepEqual(cleared.categoryIds,['cardigan']);
    await button('End sample session').click();await button('Prepare 131 gallery samples').click();await wait(()=>libraryCatalog?.patterns.filter(p=>p.present).length===131);
    // 42 Cardigans, 30 with texture, of which 12 also have stranded.
    await page.evaluate(async()=>{
      const next=structuredClone(libraryCatalog);let index=0;
      for(const pattern of next.patterns.filter(p=>p.present)){
        if(GalleryModel.designer(pattern)==='Alice Knits'){
          pattern.categoryIds=['cardigan'];pattern.categorySource='filename';
          pattern.attributeIds=index<12?['stockinette','texture']:index<24?['stranded','texture']:index<30?['texture']:[];index++;
        }else{pattern.categoryIds=['socks'];pattern.attributeIds=['texture'];}
      }
      await persistCatalog(next);renderCatalogUI();window.confirm=window.qaNativeConfirm;
    });
    await button('Pattern Library').click();await button('Clear filters').click();await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('cardigan');
    await filter().getByRole('checkbox',{name:'texture',exact:true}).check();assert.match(await page.locator('#libraryPageSummary').innerText(),/30 results/);
    await page.getByRole('combobox',{name:'Designer',exact:true}).selectOption('Alice Knits');
    await filter().getByRole('checkbox',{name:'stranded',exact:true}).check();assert.match(await page.locator('#libraryPageSummary').innerText(),/12 results/);
    await filter().getByRole('checkbox',{name:'stockinette',exact:true}).check();assert.match(await page.locator('#libraryPageSummary').innerText(),/0 results/);
    await filter().getByRole('checkbox',{name:'stockinette',exact:true}).uncheck();await filter().getByRole('checkbox',{name:'stranded',exact:true}).uncheck();
    await button('Select patterns').click();await button('Select this page (24)').click();await button('Next').click();await button('Select this page (6)').click();
    assert.equal(await page.locator('#librarySelectionCount').innerText(),'30 selected');
    const bulk=()=>page.locator('#libraryBulkAttributePicker');await bulk().getByRole('checkbox',{name:'stranded',exact:true}).check();
    await page.locator('#libraryBulkCategoryPicker').getByRole('checkbox',{name:'Hat',exact:true}).check();
    await card().getByRole('button',{name:'Edit',exact:true}).click();await attributes(card()).getByRole('checkbox',{name:'stockinette',exact:true}).check();
    await button('Apply attributes').click();assert.match(await page.locator('#libraryBulkStatus').innerText(),/Save or cancel/);await card().getByRole('button',{name:'Cancel changes',exact:true}).click();
    const before=await snapshot(),targetIds=await page.evaluate(()=>[...librarySelection.keys()]);
    assert.match(await confirm('Apply attributes',false),/30 selected patterns with stranded/);assert.equal((await snapshot()).revision,before.revision);
    await button('Inject metadata save failure').click();await confirm('Apply attributes',true);await idle();
    assert.match(await page.locator('#libraryBulkStatus').innerText(),/QA metadata save failure/);assert.equal(await page.locator('#librarySelectionCount').innerText(),'30 selected');assert.equal(await bulk().getByRole('checkbox',{name:'stranded',exact:true}).isChecked(),true);
    assert.deepEqual((await snapshot()).patterns,before.patterns);
    await button('Clear injected errors').click();await button('Select all 30 results').click();
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);await capture(`pdf-organizer-attributes-library-${width}.png`);
    }
    await confirm('Apply attributes',true);await idle();assert.match(await page.locator('#libraryPageSummary').innerText(),/0 results/);
    const after=await snapshot();for(const original of before.patterns)assert.deepEqual(after.patterns.find(p=>p.id===original.id),targetIds.includes(original.id)?{...original,attributeIds:['stranded']}:original);
    await button('Clear filters').click();assert.equal(await filter().locator('input:checked').count(),0);
    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('cardigan');await filter().getByRole('checkbox',{name:'stranded',exact:true}).check();
    await button('Select all 30 results').click();await confirm('Apply categories',true);await idle();
    assert.equal(await page.evaluate(ids=>libraryCatalog.patterns.filter(p=>ids.includes(p.id)).every(p=>p.categoryIds.join()==='hat'&&p.attributeIds.join()==='stranded'),targetIds),true);
    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('hat');await button('Select all 30 results').click();
    await confirm('Clear attributes',false);assert.equal(await page.locator('#librarySelectionCount').innerText(),'30 selected');await confirm('Clear attributes',true);await idle();
    assert.equal(await page.evaluate(ids=>libraryCatalog.patterns.filter(p=>ids.includes(p.id)).every(p=>p.categoryIds.join()==='hat'&&p.categorySource==='manual'&&p.attributeIds.length===0),targetIds),true);
    await page.reload();await button('Reconnect sample library').click();await idle();
    assert.equal(await page.evaluate(ids=>libraryCatalog.patterns.filter(p=>ids.includes(p.id)).every(p=>p.categoryIds.join()==='hat'&&p.attributeIds.length===0),targetIds),true);
    await button('End sample session').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',attributes:['stockinette','stranded','texture'],workflow:'incoming autosave, move to JSON, individual drafts/save/clear, Cardigan AND texture, multiple-attribute AND, cross-page bulk apply/clear, category independence, failed save/retry, reconnect',viewports:[2048,1280],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
