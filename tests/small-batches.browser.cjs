const assert=require('node:assert/strict');
const {chromium}=require('playwright');
async function main(){
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1600,height:1050}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  const button=name=>page.getByRole('button',{name,exact:true}),wait=(fn,arg)=>page.waitForFunction(fn,arg);
  const seed=async count=>{await page.getByRole('spinbutton',{name:'QA sample count',exact:true}).fill(String(count));await button('Prepare custom samples').click();await wait(()=>!document.querySelector('#qaCustomSeed').disabled);await wait(n=>downloadFiles.length===Math.min(n,100)&&!operationBusy,count);};
  const prepareUnique=async()=>{
    const row=page.locator('#sortingList .sort-row').nth(1);await row.locator('.filename-editor summary').click();await row.getByRole('textbox',{name:'Pattern filename for Designer_Pattern_001.pdf',exact:true}).fill('Unique_001.pdf');
  };
  const organize=async()=>{await button('Check duplicates').click();await wait(()=>duplicateCheckComplete&&!operationBusy);await button('Organize batch').click();await wait(()=>!operationBusy&&!downloadFiles.length);assert.match(await page.locator('#executeStatus').innerText(),/Organization complete/);};
  try{
    await page.goto('http://127.0.0.1:8766/?qa=1');
    for(const count of [1,2,48,99]){
      await seed(count);assert.equal(await button('No queued files').isEnabled(),false);assert.equal(await page.locator('#sortingList .sort-row').count(),count);assert.equal(await button('Check duplicates').isEnabled(),true);assert.equal(await button('Organize batch').isEnabled(),true);
      if(count>1)await prepareUnique();await organize();assert.equal(await page.evaluate(()=>queuedDownloadFiles.length),0);
      assert.equal(await page.evaluate(()=>libraryCatalog.patterns.filter(p=>p.present).length),count+1);
    }
    await seed(101);await prepareUnique();await organize();assert.equal(await page.evaluate(()=>queuedDownloadFiles.length),1);
    assert.equal(await button('Review next 1').isEnabled(),true);await button('Review next 1').click();await wait(()=>!operationBusy&&downloadFiles.length===1);await organize();
    assert.equal(await page.evaluate(()=>queuedDownloadFiles.length),0);
    // Reproduce the empty-folder -> later arrivals -> reconnect route through the real folder button.
    await seed(0);assert.equal(await page.locator('#duplicateCheckButton').isEnabled(),false);
    await page.evaluate(async()=>{
      const designer=await libraryDirectoryHandle.getDirectoryHandle('Designer'),source=await (await (await designer.getFileHandle('Pattern_001.pdf')).getFile()).text();
      const target=await downloadDirectoryHandle.getFileHandle('Designer_New_Arrival.pdf',{create:true}),writable=await target.createWritable();await writable.write(source+'\n%new-arrival');await writable.close();
      window.qaPicker=window.showDirectoryPicker;window.showDirectoryPicker=async()=>downloadDirectoryHandle;
    });
    await page.locator('#selectDownloadFolderButton').click();await wait(()=>!operationBusy&&downloadFiles.length===1);await page.evaluate(()=>window.showDirectoryPicker=window.qaPicker);
    assert.equal(await page.evaluate(()=>queuedDownloadFiles.length),0);assert.equal(await page.locator('#sortingList .sort-row').count(),1);await organize();
    assert.equal(await page.evaluate(()=>libraryCatalog.patterns.filter(p=>p.present).length),2);
    await button('End sample session').click();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',batchSizes:[0,1,2,48,99,100],workflow:'fresh small batches, real duplicate check and moves, 101-file final single-file batch, reconnect initially empty folder after one new arrival',unexpectedErrors:0}));
  }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
