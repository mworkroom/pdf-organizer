// Real Chrome and disposable OPFS files; never access J's selected folders.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:960},deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
  const button=name=>page.getByRole('button',{name,exact:true});
  const row=index=>page.locator('#sortingList .sort-row').nth(index);
  const wait=(fn,arg)=>page.waitForFunction(fn,arg);
  const show=async index=>{
    await row(index).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
    await wait(i=>document.querySelectorAll('.review-cover')[i]?.dataset.preview==='ready',index);
  };
  const settled=()=>wait(()=>!ReviewPreviews.stats.busy&&!ReviewPreviews.stats.queued);
  const pauseOne=()=>page.evaluate(()=>{
    const original=PdfPreview.render;window.qaCoverStarted=false;
    PdfPreview.render=(...args)=>{
      PdfPreview.render=original;window.qaCoverStarted=true;
      return new Promise((resolve,reject)=>{
        const signal=args[3],stop=()=>reject(new DOMException('Canceled test preview','AbortError'));
        if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
      });
    };
  });
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');assert.equal(await page.title(),'PDF Organizer');
    await button('Prepare 200 samples').click();await show(0);await settled();
    assert.equal(await page.locator('.review-cover').count(),100);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.jobs),100);
    assert.ok(await page.evaluate(()=>PdfPreview.stats.reads<15));
    const cover=await row(0).locator('.review-cover-open img').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,fit:getComputedStyle(img).objectFit}));
    assert.ok(cover.width>0&&cover.height>cover.width);assert.equal(cover.fit,'contain');
    await row(0).getByRole('checkbox',{name:'Cardigan',exact:true}).check();await row(0).getByRole('checkbox',{name:'stranded',exact:true}).check();
    await row(0).getByRole('checkbox',{name:'Exclude from this run',exact:true}).check();
    assert.equal(await row(0).locator('.review-cover-open').isEnabled(),true);
    await row(0).getByRole('checkbox',{name:'Exclude from this run',exact:true}).uncheck();
    const opened=page.waitForEvent('popup');await row(0).locator('.review-cover-open').click();const pdf=await opened;await pdf.waitForURL(url=>url.protocol==='blob:');
    assert.equal(await page.evaluate(async url=>(await (await fetch(url)).text()).startsWith('%PDF'),pdf.url()),true);await pdf.close();
    await settled();const reads=await page.evaluate(()=>PdfPreview.stats.reads);
    await page.evaluate(()=>renderSortingRows());await show(0);await settled();
    assert.equal(await page.evaluate(()=>PdfPreview.stats.reads),reads);assert.ok(await page.evaluate(()=>ReviewPreviews.stats.hits>0));
    assert.ok(await page.evaluate(()=>ReviewPreviews.stats.urls<=100));
    await wait(()=>document.querySelector('#draftSaveStatus').textContent==='Review saved');
    const stableId=await page.evaluate(()=>downloadFiles[0].patternId);
    await page.reload();await button('Resume review').click();await show(0);await settled();
    assert.equal(await page.evaluate(()=>downloadFiles[0].patternId),stableId);assert.ok(await page.evaluate(()=>ReviewPreviews.stats.hits>0));
    assert.equal(await row(0).getByRole('checkbox',{name:'Cardigan',exact:true}).isChecked(),true);assert.equal(await row(0).getByRole('checkbox',{name:'stranded',exact:true}).isChecked(),true);
    // Abort a pending cover when leaving the review. Returning must resume it.
    await pauseOne();await row(20).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));await wait(()=>window.qaCoverStarted);
    await button('Pattern Library').click();await wait(()=>!ReviewPreviews.stats.busy);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.queued),0);
    await button('Organize Files').click();await show(20);await settled();
    // File operations pause background cover work too.
    await pauseOne();await row(30).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));await wait(()=>window.qaCoverStarted);
    await page.evaluate(()=>setOperationBusy(true));await wait(()=>!ReviewPreviews.stats.busy);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.queued),0);
    await page.evaluate(()=>setOperationBusy(false));await show(30);await settled();
    // A broken cache must not prevent a cover from being rendered.
    await page.evaluate(()=>{
      window.qaCacheMethods={get:ThumbnailStore.get,put:ThumbnailStore.put};
      ThumbnailStore.get=async()=>{throw new Error('QA cache read failure');};ThumbnailStore.put=async()=>{throw new Error('QA cache write failure');};
    });
    await show(40);await settled();await page.evaluate(()=>Object.assign(ThumbnailStore,window.qaCacheMethods));
    // A corrupt source affects only its cover and can be retried after repair.
    await page.evaluate(async()=>{
      const file=downloadFiles[50];window.qaValidPdf=await (await file.handle.getFile()).arrayBuffer();
      const writable=await file.handle.createWritable();await writable.write('broken PDF sample');await writable.close();
      const metadata=await file.handle.getFile();file.size=metadata.size;file.lastModified=metadata.lastModified;renderSortingRows();
    });
    await row(50).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));await wait(()=>document.querySelectorAll('.review-cover')[50]?.dataset.preview==='error');
    assert.equal(await row(50).getByRole('button',{name:'Retry cover',exact:true}).isVisible(),true);assert.equal(await row(50).getByRole('button',{name:'Open PDF',exact:true}).isEnabled(),true);
    await row(50).getByRole('checkbox',{name:'Socks',exact:true}).check();
    await page.evaluate(async()=>{
      const file=downloadFiles[50],writable=await file.handle.createWritable();await writable.write(window.qaValidPdf);await writable.close();
      const metadata=await file.handle.getFile();file.size=metadata.size;file.lastModified=metadata.lastModified;
    });
    await row(50).getByRole('button',{name:'Retry cover',exact:true}).click();await show(50);assert.equal(await row(50).getByRole('checkbox',{name:'Socks',exact:true}).isChecked(),true);
    // Metadata mismatch is not silently rendered; a fresh snapshot gets a fresh cache key.
    await page.evaluate(async()=>{
      const file=downloadFiles[60],bytes=await (await file.handle.getFile()).arrayBuffer(),writable=await file.handle.createWritable();
      await writable.write(new Blob([bytes,'\n%changed']));await writable.close();
    });
    await row(60).evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));await wait(()=>document.querySelectorAll('.review-cover')[60]?.dataset.preview==='error');
    assert.match(await row(60).locator('.review-cover-placeholder').innerText(),/File changed/);
    await page.evaluate(async()=>{const file=downloadFiles[60],metadata=await file.handle.getFile();file.size=metadata.size;file.lastModified=metadata.lastModified;});
    await row(60).getByRole('button',{name:'Retry cover',exact:true}).click();await show(60);await settled();
    for(const width of [2048,1600,1280,390]){
      await page.setViewportSize({width,height:width===390?844:960});await show(0);
      const layout=await row(0).evaluate(el=>{
        const cover=el.querySelector('.review-cover').getBoundingClientRect(),inputs=el.querySelector('.sort-grid').getBoundingClientRect(),categories=el.querySelector('.review-categories').getBoundingClientRect();
        return {overflow:document.documentElement.scrollWidth>innerWidth,font:parseFloat(getComputedStyle(el.querySelector('.text-input')).fontSize),coverWidth:cover.width,coverRight:cover.right,inputLeft:inputs.left,inputRight:inputs.right,categoryLeft:categories.left,coverTop:cover.top,inputTop:inputs.top};
      });
      assert.equal(layout.overflow,false);assert.ok(layout.font>=16);
      if(width>=1280){assert.ok(layout.coverWidth>=150);assert.ok(layout.coverRight<layout.inputLeft&&layout.inputRight<layout.categoryLeft);assert.ok(Math.abs(layout.coverTop-layout.inputTop)<2);}
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-review-covers-${width}.png`)});
    }
    await button('Defer batch').click();await wait(()=>!operationBusy&&!downloadFiles.length);
    assert.equal(await page.evaluate(()=>ReviewPreviews.stats.urls),0);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.jobs),0);
    await button('Review next 100').click();await wait(()=>!operationBusy&&downloadFiles.length===100);await show(0);
    assert.match(await row(0).innerText(),/Designer_Pattern_100.pdf/);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.jobs),100);
    assert.equal(await page.evaluate(()=>PdfPreview.stats.maxActive),1);
    await button('End sample session').click();await wait(()=>ReviewPreviews.stats.jobs===0&&!ReviewPreviews.stats.busy);assert.equal(await page.evaluate(()=>ReviewPreviews.stats.urls),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',workflow:'visible-first covers, persistent cache, PDF open, exclusion, draft recovery, view/operation cancellation, cache failures, corrupt PDF retry, changed file, next batch, URL cleanup',viewports:[2048,1600,1280,390],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
