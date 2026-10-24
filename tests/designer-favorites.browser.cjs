// Real metadata writes in disposable OPFS libraries, in an isolated Chrome context.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1}),page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});page.on('request',request=>requests.push(request.url()));
  const button=name=>page.getByRole('button',{name,exact:true});
  const wait=fn=>page.waitForFunction(fn),idle=()=>wait(()=>!operationBusy&&Boolean(libraryCatalog));
  const saved=()=>page.evaluate(async()=>JSON.parse(await readCatalogText(libraryDirectoryHandle)));
  const search=async text=>{await page.locator('#librarySearch').fill(text);await page.waitForFunction(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const folder=name=>page.locator('#designerFolderList .designer-item').filter({has:page.getByRole('button',{name,exact:true})});
  const mark=async locator=>{await locator.click();await idle();};
  const screenshot=async name=>{if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,name)});};
  try{
    const base=process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/';await page.goto(base+'?qa=1');
    assert.equal(await page.title(),'PDF Organizer');assert.equal(await page.locator('h1').innerText(),'PDF Organizer');
    await button('Prepare 131 gallery samples').click();await wait(()=>libraryCatalog?.patterns.filter(p=>p.present).length===131);await idle();
    await page.evaluate(async()=>{
      for(let i=0;i<446;i++)await libraryDirectoryHandle.getDirectoryHandle(`Designer ${String(i).padStart(3,'0')}${i===0?' — A very long designer name for readable wrapping':''}`,{create:true});
      await reloadLibraryData();setActiveView('library');
    });
    assert.equal(await page.locator('#designerFolderList .designer-item').count(),450);
    await page.locator('#galleryFavoritesButton').click();assert.match(await page.locator('#libraryPatternList').innerText(),/No favorite designers yet/);
    await page.locator('#galleryAllDesignersButton').click();await search('Sweater_000');
    const card=page.locator('.library-pattern');await card.getByRole('button',{name:'Edit',exact:true}).click();
    await card.getByRole('checkbox',{name:'texture',exact:true}).check();
    // Favorite saves preserve pending pattern edits, and keyboard activation works.
    await card.getByRole('button',{name:'Add Alice Knits to favorites',exact:true}).focus();await page.keyboard.press('Enter');await idle();
    assert.deepEqual((await saved()).favoriteDesigners,['Alice Knits']);
    assert.equal(await card.getByRole('checkbox',{name:'texture',exact:true}).isChecked(),true);
    assert.deepEqual((await saved()).patterns.find(p=>p.path==='Alice Knits/Sweater_000.pdf').attributeIds,[]);
    await button('Cancel changes').click();
    assert.equal(await folder('Alice Knits').locator('[data-designer-favorite]').getAttribute('aria-pressed'),'true');
    await page.locator('#designerSearch').fill('Bora');assert.equal(await page.locator('#designerFolderList .designer-item').count(),1);
    await mark(folder('Bora').getByRole('button',{name:'Add Bora to favorites',exact:true}));
    await page.locator('#designerSearch').fill('');await page.locator('#designerFavoritesButton').click();assert.equal(await page.locator('#designerFolderList .designer-item').count(),2);
    await button('Clear filters').click();await button('Select patterns').click();await button('Select all 131 results').click();
    await page.locator('#galleryFavoritesButton').click();assert.equal(await page.locator('#librarySelectionCount').innerText(),'0 selected');await button('Done selecting').click();
    assert.match(await page.locator('#libraryPageSummary').innerText(),/^84 results/);
    assert.deepEqual(await page.locator('#libraryDesignerFilter option').allTextContents(),['All designers','Alice Knits','Bora']);
    await button('Next').click();await page.locator('#libraryCategoryFilter').selectOption('hat');assert.match(await page.locator('#libraryPageSummary').innerText(),/Page 1/);
    await page.locator('#libraryDesignerFilter').selectOption('Alice Knits');await search('sweater');
    assert.equal(await page.locator('.library-pattern').count(),1);assert.match(await card.innerText(),/Sweater_000/);
    await card.getByRole('button',{name:'Edit',exact:true}).click();await card.getByRole('checkbox',{name:'texture',exact:true}).check();await button('Save changes').click();await idle();
    await page.locator('#libraryAttributeFilter').getByRole('checkbox',{name:'texture',exact:true}).check();assert.equal(await page.locator('.library-pattern').count(),1);
    await button('Clear filters').click();await search('Una_Hat');await mark(card.getByRole('button',{name:'Add Una to favorites',exact:true}));
    await page.locator('#galleryFavoritesButton').click();assert.equal(await page.locator('.library-pattern').count(),1);
    // Failure must leave both the visible favorite and durable metadata unchanged.
    const before=await saved();await button('Inject metadata save failure').click();
    await mark(folder('Bora').getByRole('button',{name:'Remove Bora from favorites',exact:true}));
    assert.match(await page.locator('#designerFavoriteStatus').innerText(),/Could not save.*QA metadata save failure/);
    assert.deepEqual(await saved(),before);assert.equal(await folder('Bora').locator('[data-designer-favorite]').getAttribute('aria-pressed'),'true');
    await button('Clear injected errors').click();
    // An external JSON edit must never be overwritten by a stale favorite toggle.
    await page.evaluate(async()=>{const next=JSON.parse(await readCatalogText(libraryDirectoryHandle));next.revision++;next.favoriteDesigners.push('Nordic Studio');await writeCatalogText(libraryDirectoryHandle,CATALOG_FILE_NAME,JSON.stringify(next));});
    const external=await saved();await mark(folder('Bora').getByRole('button',{name:'Remove Bora from favorites',exact:true}));
    assert.match(await page.locator('#designerFavoriteStatus').innerText(),/Metadata changed elsewhere/);assert.deepEqual(await saved(),external);
    await button('Refresh library').click();await idle();assert.equal(await page.locator('#designerFolderList .designer-item').count(),3);
    await mark(folder('Bora').getByRole('button',{name:'Remove Bora from favorites',exact:true}));assert.equal(await page.locator('#designerFolderList .designer-item').count(),2);
    assert.deepEqual((await saved()).favoriteDesigners,['Alice Knits','Una','Nordic Studio']);
    // Browser reload + reconnect reads favorites from JSON, independent of the review draft.
    await page.reload();await button('Reconnect sample library').click();await idle();
    assert.deepEqual((await saved()).favoriteDesigners,['Alice Knits','Una','Nordic Studio']);
    await page.locator('#galleryFavoritesButton').click();assert.match(await page.locator('#libraryPageSummary').innerText(),/^85 results/);
    // Keep screenshots free of the intentionally broken PDF fixture.
    await page.evaluate(async()=>{await libraryDirectoryHandle.removeEntry('Broken.pdf');await reloadLibraryData();});
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      await wait(()=>[...document.querySelectorAll('.library-pattern')].filter(el=>el.getBoundingClientRect().top<innerHeight&&el.getBoundingClientRect().bottom>0).every(el=>el.dataset.preview!=='pending'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
      assert.equal(await page.locator('#galleryFavoritesButton').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=14),true);
      assert.equal(await page.locator('.pattern-designer').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      await screenshot(`pdf-organizer-favorites-gallery-${width}.png`);
      await page.locator('#designerFavoritesButton').click();await page.locator('#designerSearch').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#designerFolderList .designer-item').count(),2);
      await screenshot(`pdf-organizer-favorites-designers-${width}.png`);
      await button('List').click();assert.equal(await page.locator('[data-designer-favorite]').first().isVisible(),true);await button('Gallery').click();
    }
    await folder('Alice Knits').getByRole('button',{name:'Alice Knits',exact:true}).click();assert.equal(await page.locator('#libraryDesignerFilter').inputValue(),'Alice Knits');
    await page.locator('#libraryDesignerFilter').selectOption('');await page.locator('#libraryDesignerFilter').selectOption('Nordic Studio');
    await search('Hat');await page.locator('#galleryAllDesignersButton').click();assert.equal(await page.locator('#libraryDesignerFilter').inputValue(),'Nordic Studio');
    // New library isolation, then restore the old library to prove the original data remains.
    const oldRoot=await page.evaluate(()=>JSON.parse(localStorage.getItem('pdfOrganizerQaRoots')).at(-1));
    const oldLibraryId=(await saved()).libraryId;
    await button('Prepare custom samples').click();await page.waitForFunction(id=>libraryCatalog&&libraryCatalog.libraryId!==id,oldLibraryId);await idle();assert.deepEqual((await saved()).favoriteDesigners,[]);
    await wait(()=>!document.querySelector('#qaCustomSeed').disabled);
    await page.evaluate(async oldRoot=>{const root=await (await navigator.storage.getDirectory()).getDirectoryHandle(oldRoot);libraryDirectoryHandle=await root.getDirectoryHandle('Patterns');await reloadLibraryData();setActiveView('library');},oldRoot);
    assert.deepEqual((await saved()).favoriteDesigners,['Alice Knits','Una','Nordic Studio']);
    await button('Clear filters').click();await page.locator('#designerAllDesignersButton').click();await page.locator('#designerSearch').fill('Designer 000');
    assert.equal(await page.locator('#designerFolderList .designer-item').count(),1);
    assert.equal(await page.locator('.designer-folder-name').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&parseFloat(getComputedStyle(el).fontSize)>=16),true);
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(base)||url.startsWith('blob:'+base)));
    await button('End sample session').click();
    console.log(JSON.stringify({result:'PASS',designerFolders:450,viewports:[2048,1280],checks:['keyboard star','gallery and folder sync','combined filters','Singles','pending edits','selection reset','save failure','disk conflict','reload persistence','library isolation'],unexpectedErrors:errors.length,externalRequests:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
