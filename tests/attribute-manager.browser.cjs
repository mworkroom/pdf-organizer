const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1600,height:1050}});
  await context.addInitScript(()=>{window.qaNativeConfirm=window.confirm.bind(window);});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  const button=name=>page.getByRole('button',{name,exact:true}),wait=(fn,arg)=>page.waitForFunction(fn,arg),idle=()=>wait(()=>!operationBusy);
  const row=()=>page.locator('#sortingList .sort-row').first(),card=()=>page.locator('.library-pattern').first();
  const manager=()=>page.locator('#attributeManager');
  const openManager=async()=>{if(await manager().getAttribute('open')===null)await manager().locator('summary').click();};
  const saved=()=>page.evaluate(async()=>JSON.parse(await (await (await libraryDirectoryHandle.getFileHandle(CATALOG_FILE_NAME)).getFile()).text()));
  const confirm=async(name,accept)=>{await page.evaluate(()=>window.confirm=window.qaNativeConfirm);const d=page.waitForEvent('dialog'),click=button(name).click(),dialog=await d;if(accept)await dialog.accept();else await dialog.dismiss();await click;};
  const search=async text=>{await page.getByRole('searchbox',{name:'Search patterns',exact:true}).fill(text);await wait(value=>document.querySelector('#libraryPatternList').dataset.query===value,text);};
  const capture=async name=>{if(process.env.PDF_ORGANIZER_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.PDF_ORGANIZER_ARTIFACT_DIR,name)});};
  try{
    await page.goto('http://127.0.0.1:8766/?qa=1');await button('Prepare 200 samples').click();await wait(()=>!document.querySelector('#qaSeed200').disabled);await button('Pattern Library').click();await openManager();
    await page.getByRole('textbox',{name:'New attribute name',exact:true}).fill('Intarsia');await button('Add attribute').click();await idle();
    const id=await page.evaluate(()=>libraryCatalog.attributes.find(a=>a.name==='Intarsia').id);assert.ok(id);assert.equal((await saved()).attributes.length,4);
    await button('Organize Files').click();await row().getByRole('checkbox',{name:'Intarsia',exact:true}).check();await row().getByRole('checkbox',{name:'Cardigan',exact:true}).check();
    await wait(()=>document.querySelector('#draftSaveStatus').textContent==='Review saved');await page.reload();await button('Resume review').click();await wait(()=>!operationBusy&&downloadFiles.length===100);await button('Organize Files').click();
    assert.equal(await row().getByRole('checkbox',{name:'Intarsia',exact:true}).isChecked(),true);assert.equal(await page.evaluate(()=>downloadFiles[0].attributeIds[0]),id);
    await button('Pattern Library').click();await openManager();await page.getByRole('textbox',{name:'Intarsia Attribute name',exact:true}).fill('Colorwork');await button('Save attribute changes').click();await idle();
    assert.equal(await page.evaluate(id=>downloadFiles[0].attributeIds.includes(id),id),true);
    for(let i=0;i<3;i++)await button('Colorwork Attribute Move up').click();await button('Save attribute changes').click();await idle();assert.equal((await saved()).attributes[0].id,id);
    await page.getByRole('textbox',{name:'New attribute name',exact:true}).fill(' colorwork ');await button('Add attribute').click();await idle();assert.match(await page.locator('#catalogStatus').innerText(),/Invalid metadata/);assert.equal((await saved()).attributes.length,4);
    await page.getByRole('textbox',{name:'New attribute name',exact:true}).fill('');
    await page.getByRole('textbox',{name:'Colorwork Attribute name',exact:true}).fill('Intarsia');await button('Inject metadata save failure').click();await button('Save attribute changes').click();await idle();
    assert.equal((await saved()).attributes[0].name,'Colorwork');assert.equal(await page.getByRole('textbox',{name:'Colorwork Attribute name',exact:true}).inputValue(),'Intarsia');
    await button('Clear injected errors').click();await button('Save attribute changes').click();await idle();assert.equal((await saved()).attributes[0].name,'Intarsia');
    for(const width of [2048,1600,1280]){await page.setViewportSize({width,height:1050});await manager().evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);await capture(`pdf-organizer-attribute-manager-${width}.png`);}
    await search('Pattern_001');await card().getByRole('button',{name:'Edit',exact:true}).click();
    await card().getByRole('checkbox',{name:'Intarsia',exact:true}).check();await card().getByRole('checkbox',{name:'texture',exact:true}).check();await button('Save changes').click();await idle();
    await page.getByRole('combobox',{name:'Attributes condition',exact:true}).selectOption('none');assert.equal(await page.locator('.library-pattern').count(),0);
    await button('Clear filters').click();await search('Pattern_001');await card().getByRole('button',{name:'Edit',exact:true}).click();await card().getByRole('checkbox',{name:'stranded',exact:true}).check();
    await openManager();await page.getByRole('combobox',{name:'Intarsia Replacement attribute on deletion',exact:true}).selectOption('texture');
    await confirm('Intarsia Attribute Delete',false);assert.equal((await saved()).attributes[0].id,id);
    await confirm('Intarsia Attribute Delete',true);await idle();
    assert.equal((await saved()).attributes.some(a=>a.id===id),false);assert.deepEqual(await page.evaluate(()=>downloadFiles[0].attributeIds),['texture']);
    assert.equal(await card().getByRole('checkbox',{name:'stranded',exact:true}).isChecked(),true);await button('Cancel changes').click();
    assert.deepEqual((await saved()).patterns.find(p=>p.present).attributeIds,['texture']);
    await openManager();await confirm('texture Attribute Delete',true);await idle();assert.deepEqual(await page.evaluate(()=>downloadFiles[0].attributeIds),[]);
    await page.getByRole('combobox',{name:'Attributes condition',exact:true}).selectOption('none');assert.equal(await page.locator('.library-pattern').count(),1);
    await page.reload();await button('Resume review').click();await wait(()=>!operationBusy&&downloadFiles.length===100);await button('Organize Files').click();assert.equal(await row().locator('.attribute-picker input:checked').count(),0);assert.equal(await row().getByRole('checkbox',{name:'Cardigan',exact:true}).isChecked(),true);
    await button('End sample session').click();await button('Prepare 131 gallery samples').click();await wait(()=>!document.querySelector('#qaGallerySeed').disabled);await button('Pattern Library').click();await openManager();
    await page.getByRole('textbox',{name:'New attribute name',exact:true}).fill('Intarsia');await button('Add attribute').click();await idle();
    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('cardigan');await page.getByRole('combobox',{name:'Attributes condition',exact:true}).selectOption('none');
    assert.match(await page.locator('#libraryPageSummary').innerText(),/32 results/);
    await button('Select patterns').click();await button('Select all 32 results').click();await page.locator('#libraryBulkAttributePicker').getByRole('checkbox',{name:'Intarsia',exact:true}).check();
    for(const width of [1600,1280]){await page.setViewportSize({width,height:1050});await page.locator('.gallery-panel').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+scrollY-16));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),true);await capture(`pdf-organizer-attributes-none-${width}.png`);}
    await confirm('Apply attributes',true);await idle();assert.match(await page.locator('#libraryPageSummary').innerText(),/0 results/);
    await page.getByRole('combobox',{name:'Attributes condition',exact:true}).selectOption('any');assert.match(await page.locator('#libraryPageSummary').innerText(),/32 results/);
    await page.locator('#libraryAttributeFilter').getByRole('checkbox',{name:'Intarsia',exact:true}).check();assert.match(await page.locator('#libraryPageSummary').innerText(),/32 results/);
    await page.getByRole('combobox',{name:'Category',exact:true}).selectOption('sweater');assert.match(await page.locator('#libraryPageSummary').innerText(),/0 results/);
    await button('End sample session').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',workflow:'add, rename, reorder, duplicate rejection, failed save/retry, stable custom IDs, incoming draft recovery, delete cancel/replace/clear, pending editor preservation, None AND category, cross-page bulk custom attributes',viewports:[2048,1600,1280],unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
