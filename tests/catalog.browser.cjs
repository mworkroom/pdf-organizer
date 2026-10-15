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
    await ui('분류 샘플 준비').click();
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.current===100&&r.catalog?.patterns.length===3;});
    await page.locator('#sortingList').getByRole('checkbox',{name:'Hat',exact:true}).check();
    await page.locator('#sortingList').getByRole('checkbox',{name:'Scarf',exact:true}).check();
    await ui('파일명 다시 분석').click();
    await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).savedSelectedCategories?.join(',')==='hat,scarf');
    await page.reload();await ui('이어서 검토').click();
    await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===100);
    assert.equal(await page.locator('#sortingList').getByRole('checkbox',{name:'Hat',exact:true}).isChecked(),true);
    await ui('Pattern Library').click();
    await page.getByRole('searchbox',{name:'도안 검색',exact:true}).fill('Root_Sweater');
    const root=()=>page.locator('.library-pattern').filter({hasText:'Root_Sweater.pdf'});
    await root().locator('summary').click();
    await root().getByRole('checkbox',{name:'Hat',exact:true}).check();await root().getByRole('checkbox',{name:'Scarf',exact:true}).check();
    await ui('분류 저장').click();await idle();
    const rootId=(await report()).catalog.patterns.find(p=>p.path==='Root_Sweater.pdf').id;
    await page.locator('#categoryManager > summary').click();
    await page.getByRole('textbox',{name:'Sweater 이름',exact:true}).fill('Pullovers');await ui('Sweater 아래로').click();await ui('카테고리 변경 저장').click();await idle();
    assert.equal(await page.locator('.category-name').nth(0).inputValue(),'Cardigan');assert.equal(await page.locator('.category-name').nth(1).inputValue(),'Pullovers');
    await page.getByRole('textbox',{name:'새 카테고리 이름',exact:true}).fill('Accessories Test');await ui('카테고리 추가').click();await idle();
    await page.getByRole('textbox',{name:'Accessories Test 추론 키워드',exact:true}).fill('pattern');await ui('카테고리 변경 저장').click();await idle();
    await ui('자동 분류만 파일명 재분석').click();await idle();
    assert.match(await root().innerText(),/Pullovers.*Hat.*Scarf/);
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.catalog?.patterns.find(p=>p.path==='Designer/Pattern_001.pdf')?.categoryIds[0]===r.catalog?.categories.find(c=>c.name==='Accessories Test')?.id;});
    await page.getByRole('combobox',{name:'Scarf 삭제 시 대체 카테고리',exact:true}).selectOption('shawl');
    page.once('dialog',dialog=>dialog.accept());await ui('Scarf 삭제').click();await idle();assert.match(await root().innerText(),/Pullovers.*Hat.*Shawl/);
    // Unsaved library classifications and category names survive other JSON saves.
    await root().locator('summary').click();await root().getByRole('checkbox',{name:'Cowl',exact:true}).check();
    await page.getByRole('textbox',{name:'Pullovers 이름',exact:true}).fill('Pullovers Edited');await ui('카테고리 변경 저장').click();await idle();
    assert.equal(await root().getByRole('checkbox',{name:'Cowl',exact:true}).isChecked(),true);
    await root().getByRole('button',{name:'변경 취소',exact:true}).click();
    await page.setViewportSize({width:1280,height:1152});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
    assert.equal(await page.getByRole('textbox',{name:'Pullovers Edited 이름',exact:true}).evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16),true);
    if(process.env.PDF_ORGANIZER_ARTIFACT_DIR){await page.locator('#categoryManager > summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,'pdf-organizer-step3-categories-1280.png')});}
    await page.setViewportSize({width:2048,height:1152});
    await page.locator('#categoryManager > summary').click();
    await ui('Organize Files').click();await page.getByRole('checkbox',{name:'Designer_Pattern_002.pdf 일괄 작업 선택',exact:true}).check();
    await page.locator('.bulk-category-tools > summary').click();await page.locator('#bulkCategoryPicker').getByRole('checkbox',{name:'Hat',exact:true}).check();await page.locator('#bulkCategoryPicker').getByRole('checkbox',{name:'Shawl',exact:true}).check();await ui('선택 파일 분류 교체').click();
    await ui('중복 검사').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).checked);
    await ui('메타데이터 저장 실패 주입').click();await ui('현재 묶음 정리').click();
    await page.waitForFunction(()=>document.getElementById('executeStatus').textContent.includes('실행 실패')&&!document.getElementById('duplicateCheckButton').disabled);
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return !r.checked&&r.catalog?.patterns.length===3;});
    assert.equal((await report()).sourceCount,200);
    await ui('오류 주입 해제').click();await ui('중복 검사').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).checked);
    await ui('현재 묶음 정리').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===0);
    assert.match(await page.locator('#executeStatus').innerText(),/이동 98개.*중복 삭제 1개/);
    assert.equal((await report()).sourceCount,101);
    await ui('Pattern Library').click();await ui('브라우저 복구본 없이 JSON 다시 연결').click();await idle();
    await waitReport(()=>{const r=JSON.parse(document.getElementById('qaReport').textContent);return r.catalog?.patterns.find(p=>p.path==='Root_Sweater.pdf')?.categoryIds.includes('shawl')&&!r.storedVersion;});
    const restored=(await report()).catalog.patterns;assert.equal(restored.find(p=>p.path==='Root_Sweater.pdf').id,rootId);assert.deepEqual(restored.find(p=>p.path==='Designer/Pattern_002.pdf').categoryIds,['hat','shawl']);
    await ui('메타데이터 손상 주입').click();await ui('패턴 목록 새로고침').click();await idle();
    assert.match(await page.locator('#catalogStatus').innerText(),/원본 JSON을 덮어쓰지 않습니다/);
    await ui('오류 주입 해제').click();await idle();
    await root().locator('summary').click();
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.evaluate(()=>window.scrollTo(0,0));
      const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,inputSize:getComputedStyle(document.querySelector('.category-picker label')).fontSize,buttons:[...document.querySelectorAll('#libraryView button')].filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().top<innerHeight).map(b=>({left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))}));
      assert.equal(layout.scroll,layout.viewport);assert.ok(parseFloat(layout.inputSize)>=14);assert.ok(layout.buttons.every(b=>b.left>=0&&b.right<=width));
      if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,`pdf-organizer-step3-library-${width}.png`)});
    }
    await ui('Organize Files').click();await ui('다음 100개 검토').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===100);
    await page.evaluate(()=>window.scrollTo(0,0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
    if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,'pdf-organizer-step3-organize-1280.png')});
    const unexpected=errors.filter(error=>!error.includes('QA 메타데이터 저장 실패'));assert.deepEqual(unexpected,[]);
    await ui('샘플 작업 종료').click();await waitReport(()=>JSON.parse(document.getElementById('qaReport').textContent).current===0);
    console.log(JSON.stringify({result:'PASS',workflow:'categories, manual/bulk preservation, JSON recovery, corruption guard, move failure/success',viewports:[2048,1280],unexpectedErrors:unexpected.length,expectedInjectedErrors:errors.length}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
