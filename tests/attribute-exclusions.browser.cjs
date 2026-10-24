// Synthetic Men/Kids assignments in disposable OPFS, never a real pattern folder.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:2048,height:1152},deviceScaleFactor:1}),page=await context.newPage();
  await context.addInitScript(()=>window.qaNativeConfirm=window.confirm.bind(window));
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});page.on('request',request=>requests.push(request.url()));
  const button=name=>page.getByRole('button',{name,exact:true}),wait=(fn,arg)=>page.waitForFunction(fn,arg),idle=()=>wait(()=>!operationBusy&&!document.querySelector('#librarySearch').disabled);
  const include=()=>page.locator('#libraryAttributeFilter'),exclude=()=>page.locator('#libraryExcludedAttributeFilter');
  const summary=()=>page.locator('#libraryPageSummary').innerText(),saved=()=>page.evaluate(async()=>JSON.parse(await readCatalogText(libraryDirectoryHandle)));
  const search=async text=>{await page.locator('#librarySearch').fill(text);await wait(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const expected=(patterns,{texture=false,favorites=false,designer='',query=''}={})=>patterns.filter(p=>p.present&&!p.attributeIds?.some(id=>['audience-men','audience-kids'].includes(id))&&(!texture||p.attributeIds?.includes('texture'))&&(!favorites||['Alice Knits','Nordic Studio'].includes(p.path.split('/')[0]))&&(!designer||p.path.startsWith(designer+'/'))&&p.path.toLowerCase().includes(query.toLowerCase())).length;
  const screenshot=async name=>{if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,name)});};
  try{
    const base=process.env.PDF_ORGANIZER_TEST_URL||'http://127.0.0.1:8766/';await page.goto(base+'?qa=1');assert.equal(await page.title(),'PDF Organizer');assert.equal(await page.locator('h1').innerText(),'PDF Organizer');
    assert.equal(await exclude().locator('input').first().isDisabled(),true);
    await button('Prepare 131 gallery samples').click();await wait(()=>!document.querySelector('#qaGallerySeed').disabled);
    await page.evaluate(async()=>{
      await libraryDirectoryHandle.removeEntry('Broken.pdf');await reloadLibraryData();
      const next=structuredClone(libraryCatalog);next.attributes.push({id:'audience-men',name:'Men'},{id:'audience-kids',name:'Kids'});next.favoriteDesigners=['Alice Knits','Nordic Studio'];
      const profiles=[[],['texture'],['texture','audience-men'],['texture','audience-kids'],['audience-men','audience-kids'],['stranded']];
      next.patterns.filter(p=>p.present).forEach((p,index)=>{p.categoryIds=['cardigan'];p.categorySource='manual';p.attributeIds=[...profiles[index%profiles.length]];if(index===0)delete p.attributeIds;});
      await persistCatalog(next);renderCatalogUI();setActiveView('library');
    });
    const baseline=await saved();assert.match(await summary(),/^130 results/);
    await exclude().getByRole('checkbox',{name:'Men',exact:true}).check();assert.match(await summary(),/^87 results/);
    await button('Next').click();await button('Select patterns').click();await button('Select all 87 results').click();
    await exclude().getByRole('checkbox',{name:'Kids',exact:true}).check();assert.match(await summary(),/^65 results.*Page 1/);assert.equal(await page.locator('#librarySelectionCount').innerText(),'0 selected');await button('Done selecting').click();
    assert.equal(await page.evaluate(()=>selectedGalleryPatterns().every(p=>!p.attributeIds?.some(id=>['audience-men','audience-kids'].includes(id)))),true);
    await include().getByRole('checkbox',{name:'texture',exact:true}).check();assert.match(await summary(),/^22 results/);
    await include().getByRole('checkbox',{name:'Men',exact:true}).check();assert.equal(await exclude().getByRole('checkbox',{name:'Men',exact:true}).isChecked(),false);assert.match(await summary(),/^22 results/);
    await exclude().getByRole('checkbox',{name:'Men',exact:true}).check();assert.equal(await include().getByRole('checkbox',{name:'Men',exact:true}).isChecked(),false);assert.equal(await include().getByRole('checkbox',{name:'texture',exact:true}).isChecked(),true);assert.match(await summary(),/^22 results/);
    await page.locator('#libraryCategoryFilter').selectOption('cardigan');await page.locator('#galleryFavoritesButton').click();await page.locator('#libraryDesignerFilter').selectOption('Alice Knits');await search('Sweater');
    assert.match(await summary(),new RegExp(`^${expected(baseline.patterns,{texture:true,favorites:true,designer:'Alice Knits',query:'Sweater'})} results`));
    await search('');await page.locator('#libraryDesignerFilter').selectOption('');
    assert.match(await summary(),new RegExp(`^${expected(baseline.patterns,{texture:true,favorites:true})} results`));
    await page.locator('#libraryAttributeMode').selectOption('none');assert.equal(await include().locator('fieldset').isVisible(),false);assert.equal(await exclude().locator('fieldset').isVisible(),true);
    assert.equal(await page.evaluate(()=>selectedGalleryPatterns().every(p=>!p.attributeIds?.length)),true);
    await page.locator('#libraryAttributeMode').selectOption('any');assert.equal(await exclude().locator('input:checked').count(),2);
    await button('Clear filters').click();assert.match(await summary(),/^130 results/);assert.equal(await exclude().locator('input:checked').count(),0);assert.equal(await include().locator('input:checked').count(),0);
    await exclude().getByRole('checkbox',{name:'Men',exact:true}).check();await exclude().getByRole('checkbox',{name:'Kids',exact:true}).check();
    await page.locator('#libraryAttributeMode').selectOption('none');assert.match(await summary(),/^22 results/);await page.locator('#libraryAttributeMode').selectOption('any');assert.match(await summary(),/^65 results/);
    assert.deepEqual(await saved(),baseline);
    for(const width of [2048,1280]){
      await page.setViewportSize({width,height:1152});await page.locator('.gallery-panel').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));
      await wait(()=>[...document.querySelectorAll('.library-pattern')].filter(el=>el.getBoundingClientRect().top<innerHeight&&el.getBoundingClientRect().bottom>0).every(el=>el.dataset.preview!=='pending'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);
      assert.equal(await exclude().getByRole('checkbox').evaluateAll(inputs=>inputs.every(input=>{const label=input.closest('label');return parseFloat(getComputedStyle(label).fontSize)>=14&&label.scrollWidth<=label.clientWidth+1;})),true);
      assert.equal(await exclude().getByRole('checkbox',{name:'Kids',exact:true}).isVisible(),true);await screenshot(`pdf-organizer-excluded-attributes-${width}.png`);
      await button('List').click();assert.match(await summary(),/^65 results/);await button('Gallery').click();
    }
    // Rename preserves the checked exclusion by ID; deletion can replace or clear it.
    await page.locator('#attributeManager summary').click();await page.getByRole('textbox',{name:'Men Attribute name',exact:true}).fill('Menswear');await button('Save attribute changes').click();await idle();
    assert.equal(await exclude().getByRole('checkbox',{name:'Menswear',exact:true}).isChecked(),true);assert.match(await summary(),/^65 results/);
    await page.getByRole('combobox',{name:'Kids Replacement attribute on deletion',exact:true}).selectOption('audience-men');
    await button('Kids Attribute Delete').click();await idle();assert.equal(await exclude().getByRole('checkbox',{name:'Kids',exact:true}).count(),0);assert.equal(await exclude().locator('input:checked').count(),1);assert.match(await summary(),/^65 results/);
    await button('Menswear Attribute Delete').click();await idle();assert.equal(await exclude().locator('input:checked').count(),0);assert.match(await summary(),/^130 results/);
    await exclude().getByRole('checkbox',{name:'texture',exact:true}).check();
    await button('Clear filters').click();await page.reload();await button('Reconnect sample library').click();await idle();assert.equal(await exclude().locator('input:checked').count(),0);assert.match(await summary(),/^130 results/);
    assert.deepEqual(errors,[]);assert.ok(requests.every(url=>url.startsWith(base)||url.startsWith('blob:'+base)));
    await button('End sample session').click();
    console.log(JSON.stringify({result:'PASS',samples:130,viewports:[2048,1280],checks:['exclude either Men or Kids','unassigned retained','include/exclude conflict resolution','category/search/designer/favorites intersection','None and Any','pagination and selection reset','clear filters','stable rename and delete replacement','no filter metadata writes'],unexpectedErrors:0,externalRequests:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
