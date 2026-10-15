const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1}),page=await context.newPage();
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
  const button=name=>page.getByRole('button',{name,exact:true});
  const report=async()=>JSON.parse(await page.locator('#qaReport').textContent());
  const wait=(predicate,arg)=>page.waitForFunction(predicate,arg);
  const search=async text=>{await page.getByRole('searchbox',{name:'도안 검색',exact:true}).fill(text);await wait(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const root=()=>page.locator('.library-pattern').filter({hasText:'Root_Sweater.pdf'});
  const readyRoot=()=>wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='ready'&&document.querySelectorAll('.library-pattern').length===1);
  try{
    await page.goto((process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/')+'?qa=1');await button('갤러리 샘플 131개 준비').click();
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===131);
    assert.equal((await report()).pdfStats.reads,0);assert.equal((await report()).galleryCards,24);
    await button('Pattern Library').click();await wait(()=>document.querySelector('.library-pattern[data-preview="ready"]'));
    assert.ok((await report()).pdfStats.reads<131);
    await page.getByRole('combobox',{name:'카테고리',exact:true}).selectOption('hat');await page.getByRole('combobox',{name:'디자이너',exact:true}).selectOption('Alice Knits');await search('sweater');
    await wait(()=>document.querySelectorAll('.library-pattern').length===1);assert.match(await page.locator('#libraryPatternList').innerText(),/Sweater_000/);
    const multiple=page.locator('.library-pattern');await multiple.locator('summary').click();await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).check();
    await page.getByRole('searchbox',{name:'도안 검색',exact:true}).fill('no such pattern');await wait(()=>document.querySelectorAll('.library-pattern').length===0);
    await search('sweater');await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).waitFor();assert.equal(await multiple.getByRole('checkbox',{name:'Shawl',exact:true}).isChecked(),true);await button('변경 취소').click();
    await button('검색 조건 지우기').click();await wait(()=>document.querySelectorAll('.library-pattern').length===24);await button('다음').click();await wait(()=>document.querySelector('#libraryPageSummary').textContent.includes('2 / 6'));
    await search('Root_Sweater');await readyRoot();assert.match(await root().innerText(),/총 2페이지/);
    await root().locator('summary').click();await page.getByRole('spinbutton',{name:'대표 페이지',exact:true}).fill('2');
    await button('패턴 목록 새로고침').click();await wait(()=>document.querySelector('#catalogStatus').textContent.includes('먼저 저장'));assert.equal(await page.getByRole('spinbutton',{name:'대표 페이지',exact:true}).inputValue(),'2');
    await search('Broken');await search('Root_Sweater');await readyRoot();assert.equal(await page.getByRole('spinbutton',{name:'대표 페이지',exact:true}).inputValue(),'2');await button('대표 페이지 저장').click();
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).representatives.some(p=>p.path==='Root_Sweater.pdf'&&p.page===2));await readyRoot();assert.match(await root().innerText(),/대표 2 \/ 총 2페이지/);
    const originalId=(await report()).representatives[0].id;
    const readsBeforeClear=(await report()).pdfStats.reads;await button('썸네일 캐시 비우기').click();await wait(before=>JSON.parse(document.querySelector('#qaReport').textContent).pdfStats.reads>before,readsBeforeClear);await readyRoot();assert.equal((await report()).representatives[0].id,originalId);
    await root().locator('summary').click();await page.getByRole('spinbutton',{name:'대표 페이지',exact:true}).fill('99');await button('대표 페이지 저장').click();await wait(()=>document.querySelector('#catalogStatus').textContent.includes('1~2'));assert.equal((await report()).representatives[0].page,2);
    assert.equal(await page.getByRole('spinbutton',{name:'대표 페이지',exact:true}).inputValue(),'99');await button('변경 취소').click();
    await page.reload();await button('샘플 라이브러리 다시 연결').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===131);await search('Root_Sweater');await readyRoot();
    assert.equal((await report()).representatives[0].id,originalId);assert.match(await root().innerText(),/대표 2 \/ 총 2페이지/);
    await button('목록').click();await readyRoot();assert.match(await page.locator('#libraryPatternList').getAttribute('class'),/list-view/);await button('갤러리').click();await readyRoot();
    await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).previewStats.hits>0);assert.equal((await report()).pdfStats.maxActive<=1,true);
    await search('Broken');await wait(()=>document.querySelector('.library-pattern')?.dataset.preview==='error');assert.equal(await button('미리보기 다시 시도').isVisible(),true);assert.equal((await report()).galleryTotal,131);
    await search('Root_Sweater');await readyRoot();const hitsBefore=(await report()).previewStats.hits;await button('목록').click();await readyRoot();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).previewStats.hits>0);assert.ok((await report()).previewStats.hits>=hitsBefore);
    // Cache stress runs only in this isolated test context, never in J's browser.
    const limits=await page.evaluate(async()=>{
      await ThumbnailStore.clear();const small=new Blob(['cache test']);for(let i=0;i<205;i++)await ThumbnailStore.put('qa-small-'+i,{blob:small,pages:2,page:1});
      const read=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pdfOrganizerPreviewCache',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('previews'),q=tx.objectStore('previews').getAll();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};r.onerror=()=>reject(r.error);});
      const smallCount=(await read()).length;await ThumbnailStore.clear();const big=new Blob([new Uint8Array(1024*1024)]);for(let i=0;i<45;i++)await ThumbnailStore.put('qa-big-'+i,{blob:big,pages:2,page:1});
      const entries=await read(),bytes=entries.reduce((sum,item)=>sum+item.blob.size,0);await ThumbnailStore.clear();return {smallCount,bytes};
    });assert.ok(limits.smallCount<=200);assert.ok(limits.bytes<=40*1024*1024);
    await button('갤러리').click();await button('검색 조건 지우기').click();await wait(()=>document.querySelectorAll('.library-pattern').length===24);await page.getByRole('searchbox',{name:'도안 검색',exact:true}).fill('Sweater');await wait(()=>document.querySelector('#libraryPageSummary').textContent.includes('결과 33개'));
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').scrollIntoViewIfNeeded();await wait(()=>[...document.querySelectorAll('.library-pattern')].filter(card=>card.getBoundingClientRect().top<innerHeight+100&&card.getBoundingClientRect().bottom>-100).every(card=>card.dataset.preview!=='pending'));
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,inputSize:parseFloat(getComputedStyle(document.querySelector('#librarySearch')).fontSize),titleSize:parseFloat(getComputedStyle(document.querySelector('.pattern-title')).fontSize),overlaps:[...document.querySelectorAll('.gallery-toolbar button,.gallery-toolbar select')].some(element=>element.getBoundingClientRect().right>innerWidth)}));
      assert.equal(layout.width,layout.scroll);assert.ok(layout.inputSize>=16&&layout.titleSize>=16);assert.equal(layout.overlaps,false);
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-step4-gallery-${width}.png`)});
    }
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:8766/')||url.startsWith('blob:http://127.0.0.1:8766/')));
    await button('샘플 작업 종료').click();await wait(()=>JSON.parse(document.querySelector('#qaReport').textContent).galleryTotal===0);
    console.log(JSON.stringify({result:'PASS',pdfs:131,pageSize:24,workerConcurrency:1,cache:limits,viewports:[2048,1280],unexpectedErrors:errors.length,externalRequests:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
