// Isolated Chrome and disposable OPFS samples; no access to J's selected folders.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1});
  await context.addInitScript(()=>{window.qaNativeConfirm=window.confirm.bind(window);});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
  const button=name=>page.getByRole('button',{name,exact:true});
  const wait=(predicate,arg)=>page.waitForFunction(predicate,arg);
  const report=async()=>JSON.parse(await page.locator('#qaReport').textContent());
  const idle=()=>wait(()=>!document.querySelector('#refreshLibraryButton').disabled);
  const count=expected=>wait(n=>document.querySelector('#librarySelectionCount').textContent===`${n} selected`,expected);
  const row=index=>page.locator('#sortingList .sort-row').nth(index);
  const picker=()=>page.locator('#libraryBulkCategoryPicker');
  const confirm=async accept=>{const dialog=page.waitForEvent('dialog'),click=button('Apply categories').click();const opened=await dialog;const message=opened.message();if(accept)await opened.accept();else await opened.dismiss();await click;return message;};
  const artifact=async name=>{if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,name)});};
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');
    assert.equal(await page.title(),'PDF Organizer');assert.equal(await page.locator('html').getAttribute('lang'),'en');
    await button('Prepare 200 samples').click();await wait(()=>document.querySelectorAll('#sortingList .sort-row').length===100);
    assert.equal(await page.locator('#reviewFileList,#bulkDesignerInput,#applyBulkCategoriesButton').count(),0);
    // Match a real library with 27 categories, including longer custom labels.
    await page.evaluate(async()=>{
      const next=structuredClone(libraryCatalog);
      for(const name of ['Blouse','Guidebook','Stitch Dictionary','Crochet'])next.categories.push({id:name.toLowerCase().replaceAll(' ','-'),name,keywords:[]});
      await persistCatalog(next);renderCatalogUI();renderSortingRows();
    });
    assert.equal(await row(0).locator('.filename-editor').getAttribute('open'),null);
    assert.equal(await row(0).getByText('Organized pattern filename',{exact:true}).count(),0);
    await row(0).locator('.filename-editor > summary').click();
    await row(1).locator('.filename-editor > summary').click();
    await row(0).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_000.pdf',exact:true}).fill('First manual.pdf');
    await row(1).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).fill('Second manual.pdf');
    await row(1).getByRole('checkbox',{name:'Hat',exact:true}).check();
    await row(2).locator('.filename-editor > summary').click();
    await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).check();
    assert.equal(await row(2).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_002.pdf',exact:true}).isEnabled(),false);
    await row(2).getByRole('checkbox',{name:'Exclude from this run',exact:true}).uncheck();
    assert.equal(await row(2).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_002.pdf',exact:true}).isEnabled(),true);
    await wait(()=>document.querySelector('#draftSaveStatus').textContent==='Review saved');
    await page.reload();await button('Resume review').click();await wait(()=>document.querySelectorAll('#sortingList .sort-row').length===100);
    assert.equal(await row(0).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_000.pdf',exact:true}).inputValue(),'First manual.pdf');
    assert.equal(await row(1).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).inputValue(),'Second manual.pdf');
    assert.equal(await row(1).getByRole('checkbox',{name:'Hat',exact:true}).isChecked(),true);
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).queued===100);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await row(0).scrollIntoViewIfNeeded();
      const layout=await row(0).evaluate(element=>{
        const naming=element.querySelector('.review-naming').getBoundingClientRect(),categories=element.querySelector('.review-categories').getBoundingClientRect();
        return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:element.getBoundingClientRect().height,viewportHeight:innerHeight,ratio:naming.width/(naming.width+categories.width),categoryLeft:categories.left,namingRight:naming.right,topDifference:Math.abs(naming.top-categories.top),categoryCount:element.querySelectorAll('.review-categories .category-picker:not(.attribute-picker) input').length,fields:[...element.querySelectorAll('.text-input')].map(input=>({size:parseFloat(getComputedStyle(input).fontSize),left:input.getBoundingClientRect().left,right:input.getBoundingClientRect().right})),cards:document.querySelectorAll('#sortingList .sort-row').length};
      });
      assert.equal(layout.width,layout.scroll);assert.equal(layout.cards,100);assert.ok(layout.fields.every(field=>field.size>=16&&field.left>=0&&field.right<=width));
      assert.ok(layout.ratio>=0.66&&layout.ratio<=0.72);assert.ok(layout.categoryLeft>layout.namingRight);assert.ok(layout.topDifference<2);assert.equal(layout.categoryCount,27);assert.ok(layout.height<layout.viewportHeight-32);
      await row(0).evaluate(element=>window.scrollTo(0,element.getBoundingClientRect().top+scrollY-16));
      await artifact(`pdf-organizer-review-70-30-${width}.png`);
      await row(0).locator('.filename-editor > summary').click();
      await artifact(`pdf-organizer-review-70-30-default-${width}.png`);
      await row(0).locator('.filename-editor > summary').click();
    }
    // Missing filenames remain discoverable when the optional editor is collapsed.
    await row(0).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_000.pdf',exact:true}).fill('');
    await row(0).locator('.filename-editor > summary').click();
    await button('Check duplicates').click();
    await wait(()=>document.activeElement?.getAttribute('aria-label')==='Pattern filename for Designer_Pattern_000.pdf');
    assert.notEqual(await row(0).locator('.filename-editor').getAttribute('open'),null);
    await row(0).getByRole('textbox',{name:'Pattern filename for Designer_Pattern_000.pdf',exact:true}).fill('First manual.pdf');
    await button('End sample session').click();
    await button('Prepare 131 gallery samples').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===131);
    // Prepare a realistic backlog: 42 existing unclassified PDFs from one designer.
    await page.evaluate(async()=>{
      const next=structuredClone(libraryCatalog);
      for(const pattern of next.patterns)if(pattern.present&&GalleryModel.designer(pattern)==='Alice Knits'){pattern.categoryIds=['unknown'];pattern.categorySource='filename';}
      await persistCatalog(next);renderCatalogUI();window.confirm=window.qaNativeConfirm;
    });
    await button('Pattern Library').click();
    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('unknown');
    await page.getByRole('combobox',{name:'Designer',exact:true}).selectOption('Alice Knits');
    assert.match(await page.locator('#libraryPageSummary').innerText(),/42 results/);
    const before=await page.evaluate(()=>structuredClone(libraryCatalog));
    await button('Select patterns').click();await button('Select this page (24)').click();await count(24);
    assert.equal(await page.locator('.library-pattern.is-editing').count(),0);
    await button('Next').click();await count(24);assert.equal(await page.locator('[data-library-selection]:checked').count(),0);
    await button('Select this page (18)').click();await count(42);
    await button('Previous').click();await page.locator('[data-library-selection]').first().uncheck();await count(41);
    assert.equal(await page.locator('.library-pattern.is-editing').count(),0);
    await button('List').click();await count(41);await button('Gallery').click();await count(41);
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('designer');await count(41);
    await button('Select all 42 results').click();await count(42);
    // Changing filters clears selection immediately, including during search debounce.
    await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill('sweater');await count(0);
    await wait(()=>document.querySelector('#libraryPatternList').dataset.query==='sweater');
    await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill('');await wait(()=>document.querySelector('#libraryPatternList').dataset.query==='');
    await button('Select all 42 results').click();await page.locator('[data-library-selection]').first().uncheck();await count(41);
    const targetIds=await page.evaluate(()=>[...librarySelection.keys()]);
    await picker().getByRole('checkbox',{name:'Socks',exact:true}).check();await picker().getByRole('checkbox',{name:'Shawl',exact:true}).check();
    // Unsaved individual edits must be resolved explicitly; bulk editing cannot replace them.
    const firstCard=page.locator('.library-pattern').first();await firstCard.getByRole('button',{name:'Edit',exact:true}).click();await firstCard.getByRole('checkbox',{name:'Hat',exact:true}).check();
    await button('Apply categories').click();assert.match(await page.locator('#libraryBulkStatus').innerText(),/Save or cancel/);await count(41);
    await firstCard.getByRole('button',{name:'Cancel changes',exact:true}).click();
    // A canceled confirmation leaves the JSON untouched.
    assert.match(await confirm(false),/41 selected patterns.*Socks, Shawl/s);await count(41);
    assert.equal(await page.evaluate(()=>libraryCatalog.revision),before.revision);
    await button('Inject metadata save failure').click();await confirm(true);await idle();
    assert.match(await page.locator('#libraryBulkStatus').innerText(),/QA metadata save failure/);await count(41);
    assert.equal(await picker().getByRole('checkbox',{name:'Socks',exact:true}).isChecked(),true);
    assert.equal(await picker().getByRole('checkbox',{name:'Shawl',exact:true}).isChecked(),true);
    assert.equal(await page.evaluate(()=>libraryCatalog.revision),before.revision);
    await button('Clear injected errors').click();
    await button('Select all 42 results').click();await page.locator('[data-library-selection]').first().uncheck();await count(41);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('#libraryBulkTools').scrollIntoViewIfNeeded();
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#libraryBulkTools button,#libraryBulkTools label')].map(element=>({right:element.getBoundingClientRect().right,size:parseFloat(getComputedStyle(element).fontSize)}))}));
      assert.equal(layout.width,layout.scroll);assert.ok(layout.controls.every(control=>control.right<=width&&control.size>=14));
      await artifact(`pdf-organizer-library-bulk-${width}.png`);
    }
    await confirm(true);await idle();await count(0);assert.match(await page.locator('#libraryBulkStatus').innerText(),/Updated 41 patterns/);
    assert.match(await page.locator('#libraryPageSummary').innerText(),/1 results/);
    const after=await page.evaluate(()=>structuredClone(libraryCatalog));
    for(const original of before.patterns){
      const updated=after.patterns.find(pattern=>pattern.id===original.id);
      assert.deepEqual(updated,targetIds.includes(original.id)?{...original,categoryIds:['socks','shawl'],categorySource:'manual'}:original);
    }
    const json=await page.evaluate(async()=>JSON.parse(await (await (await libraryDirectoryHandle.getFileHandle(CATALOG_FILE_NAME)).getFile()).text()));
    assert.deepEqual(json.patterns,after.patterns);
    await page.locator('#categoryManager > summary').click();await button('Reanalyze automatic categories').click();await idle();
    assert.equal(await page.evaluate(ids=>libraryCatalog.patterns.filter(p=>ids.includes(p.id)).every(p=>p.categorySource==='manual'&&p.categoryIds.join(',')==='socks,shawl'),targetIds),true);
    await page.reload();await button('Reconnect sample library').click();await idle();
    assert.equal(await page.evaluate(ids=>libraryCatalog.patterns.filter(p=>ids.includes(p.id)).every(p=>p.categorySource==='manual'&&p.categoryIds.join(',')==='socks,shawl'),targetIds),true);
    assert.equal(await page.locator('#librarySelectButton').getAttribute('aria-pressed'),'false');
    await button('End sample session').click();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',review:'100 inline cards, edits on multiple files, autosave/recovery, individual exclusion',bulk:'cross-page selection, all filtered results, checkbox behavior, filter reset, draft guard, confirmation cancel, failed save/retry, durable manual categories',viewports:[2048,1280],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
