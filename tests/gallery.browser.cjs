const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1}),page=await context.newPage();
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
  const button=name=>page.getByRole('button',{name,exact:true});
  const report=async()=>JSON.parse(await page.locator('#qaReport').textContent());
  const wait=(predicate,arg)=>page.waitForFunction(predicate,arg);
  const search=async text=>{await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill(text);await wait(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const root=()=>page.locator('.library-pattern').filter({hasText:'Root_Sweater'});
  const readyRoot=async()=>{await root().scrollIntoViewIfNeeded();await wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='ready'&&document.querySelectorAll('.library-pattern').length===1);};
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');await button('Prepare 131 gallery samples').click();
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===131);
    assert.equal((await report()).pdfStats.reads,0);assert.equal((await report()).galleryCards,24);
    await button('Pattern Library').click();await page.locator('.library-pattern').first().scrollIntoViewIfNeeded();await wait(()=>document.querySelector('.library-pattern[data-preview="ready"]'));
    assert.ok((await report()).pdfStats.reads<131);
    // Card actions are independent: the preview/body do not open the editor.
    await search('Root_Sweater');await readyRoot();
    const first=()=>page.locator('.library-pattern').first();
    await first().locator('.pattern-thumbnail').click({position:{x:20,y:20}});
    await first().locator('.category-labels').click();assert.equal(await page.locator('.library-pattern.is-editing').count(),0);
    assert.equal(await page.locator('.pattern-path,.pattern-page-caption,.pattern-edit-hint').count(),0);
    // Use the actual PDF-opening path, including a native Chrome popup and blob bytes.
    const popupPromise=page.waitForEvent('popup');await first().locator('.pattern-title').focus();await page.keyboard.press('Enter');
    const pdfPopup=await popupPromise;await pdfPopup.waitForURL(url=>url.protocol==='blob:');
    assert.equal(await page.evaluate(async url=>(await (await fetch(url)).text()).startsWith('%PDF'),pdfPopup.url()),true);await pdfPopup.close();
    assert.equal(await page.locator('.library-pattern.is-editing').count(),0);
    await first().getByRole('button',{name:'Edit',exact:true}).focus();await page.keyboard.press('Enter');
    assert.equal(await first().getByRole('button',{name:'Close editor',exact:true}).getAttribute('aria-expanded'),'true');
    assert.equal(await first().locator('.gallery-editor').isVisible(),true);assert.equal(await first().locator('.pattern-path').isVisible(),true);
    await first().getByRole('button',{name:'Close editor',exact:true}).click();assert.equal(await first().locator('.gallery-editor').isVisible(),false);
    await button('Clear filters').click();await button('Select patterns').click();await button('Select all 131 results').click();await button('Next').click();
    const chosenDesigner=await first().locator('.pattern-designer').innerText();await first().locator('.pattern-designer').click();
    assert.equal(await page.getByRole('combobox',{name:'Designer',exact:true}).inputValue(),chosenDesigner);
    assert.match(await page.locator('#libraryPageSummary').innerText(),/Page 1/);assert.equal(await page.locator('#librarySelectionCount').innerText(),'0 selected');
    assert.equal(await page.locator('.library-pattern.is-editing').count(),0);await button('Done selecting').click();await button('Clear filters').click();
    await search('Una_Hat');await page.locator('.pattern-designer').click();
    assert.equal(await page.getByRole('combobox',{name:'Designer',exact:true}).inputValue(),'Una');assert.equal(await page.locator('.library-pattern').count(),1);
    assert.equal(await page.getByRole('searchbox',{name:'Search patterns',exact:true}).inputValue(),'Una_Hat');
    await first().getByRole('button',{name:'Edit',exact:true}).click();assert.match(await first().locator('.pattern-path').innerText(),/!zz_Singles\/Una_Hat.pdf/);
    await button('Clear filters').click();

    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('hat');await page.getByRole('combobox',{name:'Designer',exact:true}).selectOption('Alice Knits');await search('sweater');
    await wait(()=>document.querySelectorAll('.library-pattern').length===1);assert.match(await page.locator('#libraryPatternList').innerText(),/Sweater_000/);
    const multiple=page.locator('.library-pattern');await multiple.getByRole('button',{name:'Edit',exact:true}).click();await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).check();
    await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill('no such pattern');await wait(()=>document.querySelectorAll('.library-pattern').length===0);
    await search('sweater');await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).waitFor();assert.equal(await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).isChecked(),true);await button('Cancel changes').click();
    await button('Clear filters').click();await wait(()=>document.querySelectorAll('.library-pattern').length===24);await button('Next').click();await wait(()=>document.querySelector('#libraryPageSummary').textContent.includes('2 / 6'));
    await search('Root_Sweater');await readyRoot();assert.equal(await root().locator('.pattern-page-caption').count(),0);
    await root().getByRole('button',{name:'Edit',exact:true}).click();
    assert.equal(await root().getByRole('button',{name:'Save changes',exact:true}).isEnabled(),false);
    assert.equal(await root().getByRole('button',{name:/^Save /}).count(),1);
    const beforeCombined=await page.evaluate(()=>structuredClone(libraryCatalog));
    await root().getByRole('checkbox',{name:'Cardigan',exact:true}).check();await root().getByRole('checkbox',{name:'texture',exact:true}).check();
    await page.getByRole('spinbutton',{name:'Cover page',exact:true}).fill('2');
    await button('Refresh library').click();await wait(()=>document.querySelector('#catalogStatus').textContent.includes('Save or cancel'));assert.equal(await page.getByRole('spinbutton',{name:'Cover page',exact:true}).inputValue(),'2');
    await search('Broken');await search('Root_Sweater');await readyRoot();assert.equal(await page.getByRole('spinbutton',{name:'Cover page',exact:true}).inputValue(),'2');
    await button('Inject metadata save failure').click();await button('Save changes').click();await wait(()=>!operationBusy);
    assert.match(await page.locator('#catalogStatus').innerText(),/QA metadata save failure/);
    assert.deepEqual(await page.evaluate(()=>libraryCatalog),beforeCombined);
    assert.equal(await root().getByRole('checkbox',{name:'Cardigan',exact:true}).isChecked(),true);assert.equal(await root().getByRole('checkbox',{name:'texture',exact:true}).isChecked(),true);
    assert.equal(await page.getByRole('spinbutton',{name:'Cover page',exact:true}).inputValue(),'2');
    assert.deepEqual(await page.evaluate(async()=>JSON.parse(await (await (await libraryDirectoryHandle.getFileHandle(CATALOG_FILE_NAME)).getFile()).text())),beforeCombined);
    // The one button stays reachable at both desktop widths while all drafts are pending.
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await root().evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      const bounds=await button('Save changes').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-unified-save-${width}.png`)});
    }
    await button('Clear injected errors').click();await button('Save changes').click();await wait(()=>!operationBusy);
    const afterCombined=await page.evaluate(()=>structuredClone(libraryCatalog));assert.equal(afterCombined.revision,beforeCombined.revision+1);
    for(const original of beforeCombined.patterns){const updated=afterCombined.patterns.find(p=>p.id===original.id);assert.deepEqual(updated,original.path==='Root_Sweater.pdf'?{...original,categoryIds:['sweater','cardigan'],categorySource:'manual',attributeIds:['texture'],representativePage:2}:original);}
    assert.equal(await page.evaluate(()=>hasPendingLibraryEdits()),false);
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).representatives.some(p=>p.path==='Root_Sweater.pdf'&&p.page===2));await readyRoot();await root().getByRole('button',{name:'Edit',exact:true}).click();assert.match(await root().innerText(),/Cover page 2 \/ 2 pages/);await root().getByRole('button',{name:'Close editor',exact:true}).click();
    const originalId=(await report()).representatives[0].id;
    const readsBeforeClear=(await report()).pdfStats.reads;await button('Clear thumbnail cache').click();await wait(before=>JSON.parse(document.querySelector('#qaReport').textContent).pdfStats.reads>before,readsBeforeClear);await readyRoot();assert.equal((await report()).representatives[0].id,originalId);
    await root().getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('spinbutton',{name:'Cover page',exact:true}).fill('99');
    await root().getByRole('checkbox',{name:'Hat',exact:true}).check();await root().getByRole('checkbox',{name:'stranded',exact:true}).check();
    const beforeInvalid=await page.evaluate(()=>structuredClone(libraryCatalog));await button('Save changes').click();await wait(()=>document.querySelector('#catalogStatus').textContent.includes('1~2'));assert.equal((await report()).representatives[0].page,2);
    assert.equal(await page.getByRole('spinbutton',{name:'Cover page',exact:true}).inputValue(),'99');assert.deepEqual(await page.evaluate(()=>libraryCatalog),beforeInvalid);assert.equal(await root().getByRole('checkbox',{name:'Hat',exact:true}).isChecked(),true);assert.equal(await root().getByRole('checkbox',{name:'stranded',exact:true}).isChecked(),true);await button('Cancel changes').click();
    await page.reload();await button('Reconnect sample library').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===131);await search('Root_Sweater');await readyRoot();
    assert.equal((await report()).representatives[0].id,originalId);await root().getByRole('button',{name:'Edit',exact:true}).click();assert.match(await root().innerText(),/Cover page 2 \/ 2 pages/);await root().getByRole('button',{name:'Close editor',exact:true}).click();
    await button('List').click();await readyRoot();assert.match(await page.locator('#libraryPatternList').getAttribute('class'),/list-view/);await button('Gallery').click();await readyRoot();
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).previewStats.hits>0);assert.equal((await report()).pdfStats.maxActive<=1,true);
    await search('Broken');await wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='error');assert.equal(await button('Retry preview').isVisible(),true);assert.equal((await report()).galleryTotal,131);
    await first().getByRole('button',{name:'Edit',exact:true}).click();await first().getByRole('checkbox',{name:'texture',exact:true}).check();
    await page.evaluate(()=>{window.qaOriginalObtain=GalleryPreviews.obtain;GalleryPreviews.obtain=async()=>{throw new Error('Untouched cover must not be validated');};});
    await button('Save changes').click();await wait(()=>!operationBusy);await page.evaluate(()=>{GalleryPreviews.obtain=window.qaOriginalObtain;});
    const broken=await page.evaluate(()=>libraryCatalog.patterns.find(p=>p.path==='Broken.pdf'));assert.deepEqual(broken.attributeIds,['texture']);assert.equal(broken.categorySource,'filename');assert.deepEqual(broken.categoryIds,['unknown']);

    await search('Root_Sweater');await readyRoot();const hitsBefore=(await report()).previewStats.hits;await button('List').click();await readyRoot();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).previewStats.hits>0);assert.ok((await report()).previewStats.hits>=hitsBefore);
    // Cache stress runs only in this isolated test context, never in J's browser.
    const limits=await page.evaluate(async()=>{
      await ThumbnailStore.clear();const small=new Blob(['cache test']);for(let i=0;i<205;i++)await ThumbnailStore.put('qa-small-'+i,{blob:small,pages:2,page:1});
      const read=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pdfOrganizerPreviewCache',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('previews'),q=tx.objectStore('previews').getAll();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);});
      const smallCount=(await read()).length;await ThumbnailStore.clear();const big=new Blob([new Uint8Array(1024*1024)]);for(let i=0;i<45;i++)await ThumbnailStore.put('qa-big-'+i,{blob:big,pages:2,page:1});
      const entries=await read(),bytes=entries.reduce((sum,item)=>sum+item.blob.size,0);await ThumbnailStore.clear();return {smallCount,bytes};
    });assert.ok(limits.smallCount<=200);assert.ok(limits.bytes<=40*1024*1024);
    await button('Gallery').click();await button('Clear filters').click();await wait(()=>document.querySelectorAll('.library-pattern').length===24);await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill('Sweater');await wait(()=>document.querySelector('#libraryPageSummary').textContent.includes('33 results'));
    for(const width of [2048,1600,1536,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').scrollIntoViewIfNeeded();await wait(()=>[...document.querySelectorAll('.library-pattern')].filter(card=>card.getBoundingClientRect().top<innerHeight+100&&card.getBoundingClientRect().bottom>-100).every(card=>card.dataset.preview!=='pending'));
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,inputSize:parseFloat(getComputedStyle(document.querySelector('#librarySearch')).fontSize),titleSize:parseFloat(getComputedStyle(document.querySelector('.pattern-title')).fontSize),overlaps:[...document.querySelectorAll('.gallery-toolbar button,.gallery-toolbar select')].some(element=>element.getBoundingClientRect().right>innerWidth)}));
      const geometry=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('.library-pattern')],top=cards[0].getBoundingClientRect().top,thumb=cards[0].querySelector('.pattern-thumbnail').getBoundingClientRect(),edit=cards[0].querySelector('.pattern-edit-button').getBoundingClientRect();
        return {columns:cards.filter(card=>Math.abs(card.getBoundingClientRect().top-top)<2).length,ratio:thumb.height/thumb.width,fit:getComputedStyle(cards[0].querySelector('img')).objectFit,editInside:edit.right<=thumb.right&&edit.bottom<=thumb.bottom&&thumb.right-edit.right<12&&thumb.bottom-edit.bottom<12,hiddenInfo:document.querySelectorAll('.pattern-card-header .pattern-path,.pattern-card-header .pattern-page-caption').length};
      });
      assert.equal(geometry.columns,width>=1600?7:width===1536?6:5);assert.ok(Math.abs(geometry.ratio-Math.SQRT2)<0.02);assert.equal(geometry.fit,'cover');assert.equal(geometry.editInside,true);assert.equal(geometry.hiddenInfo,0);
      assert.equal(layout.width,layout.scroll);assert.ok(layout.inputSize>=16&&layout.titleSize>=16);assert.equal(layout.overlaps,false);
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-window-gallery-${width}.png`)});
    }
    // Add real OPFS files for long-name wrapping and landscape cropping checks.
    await page.evaluate(async()=>{
      const source=await (await (await libraryDirectoryHandle.getFileHandle('Root_Sweater.pdf')).getFile()).text();
      const singles=await libraryDirectoryHandle.getDirectoryHandle('!zz_Singles');
      for(const [folder,name,content] of [[singles,'11wildswans_Unbound by Annamária Ötvös (11wildswans).pdf',source],[libraryDirectoryHandle,'Landscape_Sweater.pdf',source.replaceAll('/MediaBox [0 0 400 600]','/MediaBox [0 0 600 400]')]]){
        const writable=await (await folder.getFileHandle(name,{create:true})).createWritable();await writable.write(content);await writable.close();
      }
    });
    await button('Clear filters').click();await button('Refresh library').click();await wait(()=>libraryCatalog?.patterns.filter(p=>p.present).length===133);
    await search('Landscape_Sweater');await wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='ready');
    const landscape=await page.locator('.pattern-thumbnail img').evaluate(img=>({wide:img.naturalWidth>img.naturalHeight,fit:getComputedStyle(img).objectFit}));assert.equal(landscape.wide,true);assert.equal(landscape.fit,'cover');
    await search('Unbound');await wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='ready');
    for(const width of [2048,1760,1600,1536,1280,390]){
      await page.setViewportSize({width,height:width===390?844:1152});
      const wrapped=await page.locator('.library-pattern').evaluate(card=>{
        const title=card.querySelector('.pattern-title'),header=card.querySelector('.pattern-card-header'),edit=card.querySelector('.pattern-edit-button'),thumb=card.querySelector('.pattern-thumbnail');
        return {noOverflow:document.documentElement.scrollWidth===innerWidth,titleFits:title.scrollWidth<=title.clientWidth+1,titleSize:parseFloat(getComputedStyle(title).fontSize),noDuplicatePath:header.querySelectorAll('.pattern-path,.pattern-page-caption').length,editVisible:edit.getBoundingClientRect().right<=thumb.getBoundingClientRect().right};
      });
      assert.equal(wrapped.noOverflow,true);assert.equal(wrapped.titleFits,true);assert.ok(wrapped.titleSize>=16);assert.equal(wrapped.noDuplicatePath,0);assert.equal(wrapped.editVisible,true);
      await button('List').click();await page.locator('.pattern-edit-button').click();assert.equal(await page.locator('.gallery-editor').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);await page.getByRole('button',{name:'Close editor',exact:true}).click();await button('Gallery').click();
    }
    // Remove the intentionally corrupt test file before capturing the normal browsing state.
    await page.evaluate(()=>libraryDirectoryHandle.removeEntry('Broken.pdf'));
    await button('Clear filters').click();await button('Refresh library').click();await wait(()=>libraryCatalog?.patterns.filter(p=>p.present).length===132);
    // Show the seven-column result from the top of the panel, with long-name and landscape samples included.
    for(const width of [2048,1600,1536,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      await wait(()=>[...document.querySelectorAll('.library-pattern')].filter(card=>card.getBoundingClientRect().top<innerHeight+100&&card.getBoundingClientRect().bottom>-100).every(card=>card.dataset.preview!=='pending'));
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-window-gallery-${width}.png`)});
    }
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:8766/')||url.startsWith('blob:http://127.0.0.1:8766/')));
    await button('End sample session').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===0);
    console.log(JSON.stringify({result:'PASS',pdfs:131,pageSize:24,workerConcurrency:1,cache:limits,viewports:[2048,1760,1600,1536,1280,390],additionalLayoutSamples:2,unexpectedErrors:errors.length,externalRequests:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
