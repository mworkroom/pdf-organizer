// Only injected by the optional local QA server. Every sample uses origin-private storage.
(() => {
  const fixtureRoots = JSON.parse(localStorage.getItem('pdfOrganizerQaRoots') || '[]');
  let fixtureDownloads;
  const realSave = ReviewDraftStore.save;
  const realMove = copyFileThenRemoveOriginal;
  const realCatalogWrite = writeCatalogText;
  const realPersistCatalog = persistCatalog;
  const realConfirm = window.confirm.bind(window);
  const realAlert = window.alert.bind(window);
  window.confirm = message => downloadDirectoryHandle && downloadDirectoryHandle === fixtureDownloads ? true : realConfirm(message);
  window.alert = message => {
    if(downloadDirectoryHandle && downloadDirectoryHandle === fixtureDownloads) { lastError = String(message); updateReport(); }
    else realAlert(message);
  };
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = '<h2>Local QA tools</h2><p class="note">Samples are created only in temporary browser storage.</p><button id="qaSeed400">Prepare 400 samples</button> <button id="qaSeed200">Prepare 200 samples</button> <button id="qaLegacy">Prepare 400 legacy reviews</button> <button id="qaBreakSave">Inject save failure</button> <button id="qaBreakMove">Inject move failure</button> <button id="qaFolderFailure">Folder read failure</button> <button id="qaFix">Clear injected errors</button> <button id="qaCleanup">End sample session</button><output id="qaReport" style="display:block;white-space:pre-wrap;margin-top:16px;font-size:14px"></output>';
  document.body.append(panel);
  const categorySeed=document.createElement('button');categorySeed.id='qaCategorySeed';categorySeed.textContent='Prepare category samples';panel.insertBefore(categorySeed,reportPlaceholder());
  function reportPlaceholder(){return panel.querySelector('#qaReport');}
  const report = panel.querySelector('#qaReport');
  let lastError = '';
  let catalogOriginalForQA=null;

  async function guard() {
    if(!downloadDirectoryHandle&&pendingDraft?.downloadDirectory){
      const origin=await navigator.storage.getDirectory();let known=false;
      for(const name of fixtureRoots){if(!/^pdf-organizer-qa-\d+$/.test(name))continue;try{const dir=await (await origin.getDirectoryHandle(name)).getDirectoryHandle('Downloads');if(await dir.isSameEntry(pendingDraft.downloadDirectory))known=true;}catch{}}
      if(!known)throw new Error('QA tools cannot be applied to reviews from real folders.');
    }
    if (downloadDirectoryHandle && !fixtureDownloads) await recoverFixtureHandle();
    if (downloadDirectoryHandle && (!fixtureDownloads || !await fixtureDownloads.isSameEntry(downloadDirectoryHandle))) throw new Error('QA tools cannot be applied to real folders.');
  }
  async function recoverFixtureHandle() {
    const origin=await navigator.storage.getDirectory();
    for(const name of fixtureRoots) {
      if(!/^pdf-organizer-qa-\d+$/.test(name))continue;
      try {
        const dir=await (await origin.getDirectoryHandle(name)).getDirectoryHandle('Downloads');
        if(await dir.isSameEntry(downloadDirectoryHandle)){fixtureDownloads=downloadDirectoryHandle;return;}
      } catch {}
    }
  }
  const samplePdf = index => {
    const text = number => number===1?
      `BT /F1 30 Tf 40 540 Td (KNIT ${String(index).padStart(3,'0')}) Tj ET\nBT /F1 15 Tf 40 510 Td (Sample pattern / cover) Tj ET\n0.93 g 140 390 m 80 330 l 110 290 l 145 320 l 145 200 l 255 200 l 255 320 l 290 290 l 320 330 l 260 390 l 225 410 l 175 410 l h f\n0.2 G 2 w 140 390 m 80 330 l 110 290 l 145 320 l 145 200 l 255 200 l 255 320 l 290 290 l 320 330 l 260 390 l 225 410 l 175 410 l h S\n175 410 m 175 385 225 385 225 410 c S\n0 g BT /F1 14 Tf 40 150 Td (Wool / needles / size guide) Tj ET`:
      `BT /F1 27 Tf 40 540 Td (MATERIALS & SIZING) Tj ET\nBT /F1 17 Tf 40 490 Td (Pattern ${index} / page two) Tj ET\n0.4 G 1 w 40 430 320 150 re S\n40 380 m 360 380 l S\n40 330 m 360 330 l S\n150 280 m 150 430 l S\n250 280 m 250 430 l S\n0 g BT /F1 16 Tf 60 400 Td (Size) Tj ET\nBT /F1 16 Tf 175 400 Td (S) Tj ET\nBT /F1 16 Tf 280 400 Td (M) Tj ET\nBT /F1 15 Tf 40 200 Td (This page is a distinct thumbnail.) Tj ET`;
    const page = content => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
      page(text(1)),
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
      page(text(2)), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let data='%PDF-1.4\n';const offsets=[0];
    objects.forEach((object,index)=>{offsets.push(data.length);data+=`${index+1} 0 obj\n${object}\nendobj\n`;});
    const xref=data.length;
    data+='xref\n0 8\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
    data+=`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n%`;
    return data+'x'.repeat(65536-data.length);
  };

  async function seed(count) {
    await draftReady;
    await guard();
    ReviewDraftStore.save = realSave; copyFileThenRemoveOriginal = realMove;writeCatalogText=realCatalogWrite;categoryEditorDirty=false;libraryCategoryDrafts.clear();libraryAttributeDrafts.clear();libraryPageDrafts.clear();
    const origin = await navigator.storage.getDirectory();
    const name = 'pdf-organizer-qa-' + Date.now();
    const root = await origin.getDirectoryHandle(name, {create:true}); fixtureRoots.push(name);
    localStorage.setItem('pdfOrganizerQaRoots',JSON.stringify(fixtureRoots));
    const downloads = await root.getDirectoryHandle('Downloads', {create:true});
    const library = await root.getDirectoryHandle('Patterns', {create:true});
    const designer = await library.getDirectoryHandle('Designer', {create:true});
    const put = async (dir, name, content) => {
      const handle = await dir.getFileHandle(name, {create:true});
      const writable = await handle.createWritable(); await writable.write(content); await writable.close();
    };
    for (let index=0; index<count; index++) {
      const contentIndex = index===99 || index===100 ? 0 : index;
      await put(downloads, `Designer_Pattern_${String(index).padStart(3,'0')}.pdf`, samplePdf(contentIndex));
    }
    await put(designer, 'Pattern_001.pdf', samplePdf(999));
    suppressDraftSave = true;
    resetBatchState(); digestCache.clear(); pendingDraft = null;
    draftRecovery.classList.add('hidden');
    downloadDirectoryHandle = downloads; fixtureDownloads = downloads; libraryDirectoryHandle = library;
    designerAliases = {Designer:'Designer'};
    localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(designerAliases));
    await reloadLibraryData(); await reloadDownloadData();
    renderAliasList(); renderDesignerFolders(designerFolders);
    downloadFolderName.textContent = 'Selected folder: Downloads';
    libraryFolderName.textContent = 'Selected folder: Patterns';
    setActiveView('organize'); renderSortingRows();
    executeStatus.className='execute-status';executeStatus.textContent='';
    suppressDraftSave = false;
    scheduleDraftSave(); await saveReviewDraft();
    lastError = '';
  }
  function wrap(action) {
    return async () => {
      const buttonStates = [...panel.querySelectorAll('button')].map(button=>[button,button.disabled]);
      panel.querySelectorAll('button').forEach(button=>button.disabled=true);
      try { await action(); } catch(error) { lastError = error.message; }
      finally { buttonStates.forEach(([button,disabled])=>button.disabled=disabled); await updateReport(); }
    };
  }
  document.getElementById('qaSeed400').onclick = wrap(()=>seed(400));
  document.getElementById('qaSeed200').onclick = wrap(()=>seed(200));
  categorySeed.onclick=wrap(async()=>{
    await seed(200);
    const put=async(dir,name)=>{const handle=await dir.getFileHandle(name,{create:true});const writable=await handle.createWritable();await writable.write(samplePdf(888));await writable.close();};
    await put(libraryDirectoryHandle,'Root_Sweater.pdf');
    const special=await libraryDirectoryHandle.getDirectoryHandle('!Special',{create:true});const nested=await special.getDirectoryHandle('Nested',{create:true});await put(nested,'Cowl.pdf');
    await reloadLibraryData();
  });
  const gallerySeed=document.createElement('button');gallerySeed.id='qaGallerySeed';gallerySeed.textContent='Prepare 131 gallery samples';panel.insertBefore(gallerySeed,report);
  gallerySeed.onclick=wrap(async()=>{
    await seed(0);await guard();
    const put=async(dir,name,content)=>{const handle=await dir.getFileHandle(name,{create:true});const writable=await handle.createWritable();await writable.write(content);await writable.close();};
    for(let i=0;i<126;i++){
      const designer=['Alice Knits','Bora','Nordic Studio'][i%3],kind=['Sweater','Cardigan','Shawl','Hat'][i%4];
      const directory=await libraryDirectoryHandle.getDirectoryHandle(designer,{create:true});await put(directory,`${kind}_${String(i).padStart(3,'0')}.pdf`,samplePdf(i));
    }
    await put(libraryDirectoryHandle,'Root_Sweater.pdf',samplePdf(500));
    const singles=await libraryDirectoryHandle.getDirectoryHandle('!zz_Singles',{create:true});await put(singles,'Una_Hat.pdf',samplePdf(501));
    const special=await libraryDirectoryHandle.getDirectoryHandle('!Special',{create:true}),nested=await special.getDirectoryHandle('Nested',{create:true});await put(nested,'Cowl.pdf',samplePdf(502));
    await put(libraryDirectoryHandle,'Broken.pdf','broken PDF sample');
    await reloadLibraryData();
    const next=structuredClone(libraryCatalog),multiple=next.patterns.find(p=>p.path==='Alice Knits/Sweater_000.pdf');multiple.categoryIds=['sweater','hat'];multiple.categorySource='manual';await persistCatalog(next);renderCatalogUI();
  });
  const textPdf=pages=>{
    const fontId=3+pages.length*2,objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
    pages.forEach((title,i)=>{
      const content=title?`BT /F1 30 Tf 40 540 Td (${title}) Tj ET\nBT /F1 12 Tf 40 450 Td (Needles and materials for knitting. Wear with a hat.) Tj ET`:'0.7 g 40 40 100 100 re f';
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let data='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(data.length);data+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=data.length;
    data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n%`;
    return data+'x'.repeat(65536-data.length);
  };
  const maintenanceSeed=document.createElement('button');maintenanceSeed.textContent='Prepare analysis and recovery samples';panel.insertBefore(maintenanceSeed,report);
  maintenanceSeed.onclick=wrap(async()=>{
    await seed(0);await guard();persistCatalog=realPersistCatalog;
    const designer=await libraryDirectoryHandle.getDirectoryHandle('Designer');await designer.removeEntry('Pattern_001.pdf');
    const samples={'Mystery.pdf':['Winter Sweater','MATERIALS','SIZING','Hat'],'Manual.pdf':['Summer Hat','SIZING'],'Conflict_Shawl.pdf':['Cozy Cowl'],'Blank.pdf':[''],'Broken.pdf':null,'Legacy.pdf':['Warm Scarf'],'Preserved.pdf':['Classic Cardigan','SIZING']};
    for(const [name,pages] of Object.entries(samples)){const handle=await libraryDirectoryHandle.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(pages?textPdf(pages):'broken PDF sample');await writer.close();}
    await loadLibraryCatalog();const next=structuredClone(libraryCatalog);
    for(const p of next.patterns.filter(p=>['Manual.pdf','Preserved.pdf'].includes(p.path))){p.categorySource='manual';p.categoryIds=p.path==='Manual.pdf'?['unknown']:['cardigan','hat'];p.representativePage=2;}
    // Legacy metadata has never had a hash; emulate a real pre-analysis external rename.
    const old=await libraryDirectoryHandle.getFileHandle('Legacy.pdf'),file=await old.getFile(),target=await libraryDirectoryHandle.getFileHandle('Legacy_Renamed.pdf',{create:true}),writer=await target.createWritable();await writer.write(file);await writer.close();await libraryDirectoryHandle.removeEntry('Legacy.pdf');
    await persistCatalog(next);await loadLibraryCatalog();repairMissingId='';repairCandidateId='';repairProof=null;maintenanceMessage='';renderCatalogUI();
  });
  const pauseAfterOne=document.createElement('button');pauseAfterOne.textContent='Pause after analyzing one file';panel.insertBefore(pauseAfterOne,report);
  pauseAfterOne.onclick=wrap(async()=>{await guard();persistCatalog=async next=>{await realPersistCatalog(next);if(analysisRun){persistCatalog=realPersistCatalog;analysisRun.controller.abort();}};});
  const renamePreserved=document.createElement('button');renamePreserved.textContent='Create moved samples and duplicate candidates';panel.insertBefore(renamePreserved,report);
  renamePreserved.onclick=wrap(async()=>{
    await guard();const old=await libraryDirectoryHandle.getFileHandle('Preserved.pdf'),file=await old.getFile();
    const folder=await libraryDirectoryHandle.getDirectoryHandle('Moved',{create:true});
    for(const name of ['Renamed.pdf','Same_Copy.pdf']){const handle=await folder.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write(file);await writer.close();}
    await libraryDirectoryHandle.removeEntry('Preserved.pdf');await loadLibraryCatalog();
  });
  const reconnect=document.createElement('button');reconnect.textContent='Reconnect sample library';panel.insertBefore(reconnect,report);
  reconnect.onclick=wrap(async()=>{
    await draftReady;await guard();const name=fixtureRoots.at(-1);if(!/^pdf-organizer-qa-\d+$/.test(name))throw new Error('No sample folder available.');
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle(name);libraryDirectoryHandle=await root.getDirectoryHandle('Patterns');downloadDirectoryHandle=await root.getDirectoryHandle('Downloads');fixtureDownloads=downloadDirectoryHandle;
    resetBatchState();await reloadLibraryData();await reloadDownloadData();libraryFolderName.textContent='Selected folder: Patterns';downloadFolderName.textContent='Selected folder: Downloads';setActiveView('library');
  });
  const metadataFail=document.createElement('button');metadataFail.id='qaBreakCatalog';metadataFail.textContent='Inject metadata save failure';panel.insertBefore(metadataFail,report);
  metadataFail.onclick=wrap(async()=>{await guard();writeCatalogText=async(root,name,value)=>{if(root===catalogRoot&&name===CATALOG_FILE_NAME)throw new Error('QA metadata save failure');return realCatalogWrite(root,name,value);};});
  const jsonReload=document.createElement('button');jsonReload.id='qaReloadJson';jsonReload.textContent='Reload JSON without browser review';panel.insertBefore(jsonReload,report);
  jsonReload.onclick=wrap(async()=>{await guard();clearTimeout(draftTimer);await draftSaveChain;await realSave(null);libraryCatalog=null;catalogDiskText=null;await loadLibraryCatalog();});
  const corrupt=document.createElement('button');corrupt.id='qaCorruptCatalog';corrupt.textContent='Inject corrupt metadata';panel.insertBefore(corrupt,report);
  corrupt.onclick=wrap(async()=>{await guard();catalogOriginalForQA=await readCatalogText(libraryDirectoryHandle);await realCatalogWrite(libraryDirectoryHandle,CATALOG_FILE_NAME,'{"version":99}');});
  document.getElementById('qaLegacy').onclick = wrap(async()=>{
    await seed(400);
    // Simulate a closed v1 application: no v2 autosave may race the injected snapshot.
    suppressDraftSave = true; clearTimeout(draftTimer); await draftSaveChain;
    const files = serializeBatchFiles().map(file=>({...file,patternFileName:`saved-${file.name}`,patternManuallyEdited:true,specialFolderKey:'scarves'}));
    await realSave({version:1,downloadDirectory:downloadDirectoryHandle,libraryDirectory:libraryDirectoryHandle,files});
    savedDraftRevision = draftRevision;
    lastError = 'Legacy review ready. Refresh the page and select Resume review.';
  });
  document.getElementById('qaBreakSave').onclick = wrap(async()=>{
    await guard(); ReviewDraftStore.save = async()=>{throw new Error('QA save failure');};
  });
  document.getElementById('qaBreakMove').onclick = wrap(async()=>{
    await guard(); copyFileThenRemoveOriginal = async plan=>{
      if(plan.sourceName.includes('003'))throw new Error('QA move interrupted');
      return realMove(plan);
    };
  });
  document.getElementById('qaFix').onclick = wrap(async()=>{
    ReviewDraftStore.save=realSave;copyFileThenRemoveOriginal=realMove;writeCatalogText=realCatalogWrite;lastError='';
    if(catalogOriginalForQA){await guard();await realCatalogWrite(libraryDirectoryHandle,CATALOG_FILE_NAME,catalogOriginalForQA);catalogOriginalForQA=null;await loadLibraryCatalog();}
  });
  document.getElementById('qaFolderFailure').onclick = wrap(async()=>{
    await guard();
    const nativePicker=window.showDirectoryPicker, nativeReload=reloadDownloadData;
    const origin=await navigator.storage.getDirectory();
    const name='pdf-organizer-qa-'+Date.now();
    const root=await origin.getDirectoryHandle(name,{create:true});fixtureRoots.push(name);
    localStorage.setItem('pdfOrganizerQaRoots',JSON.stringify(fixtureRoots));
    window.showDirectoryPicker=async()=>root;
    reloadDownloadData=async()=>{throw new Error('QA folder read failure');};
    document.getElementById('selectDownloadFolderButton').click();
    try {
      await new Promise(resolve=>setTimeout(resolve,0));
      for(let count=0;operationBusy&&count<400;count++)await new Promise(resolve=>setTimeout(resolve,25));
    } finally {window.showDirectoryPicker=nativePicker;reloadDownloadData=nativeReload;}
  });
  document.getElementById('qaCleanup').onclick = wrap(async()=>{
    await guard();
    ReviewDraftStore.save=realSave;copyFileThenRemoveOriginal=realMove;writeCatalogText=realCatalogWrite;persistCatalog=realPersistCatalog;
    clearTimeout(draftTimer);await draftSaveChain;
    await realSave(null);
    const origin=await navigator.storage.getDirectory();
    GalleryPreviews.suspend();
    for(const name of fixtureRoots){
      if(!/^pdf-organizer-qa-\d+$/.test(name))throw new Error('Unexpected fixture');
      try{const patterns=await (await origin.getDirectoryHandle(name)).getDirectoryHandle('Patterns');const data=JSON.parse(await (await (await patterns.getFileHandle(CATALOG_FILE_NAME)).getFile()).text());await ThumbnailStore.removeLibrary(data.libraryId);}catch{}
      await origin.removeEntry(name,{recursive:true});
    }
    fixtureRoots.length=0;localStorage.removeItem('pdfOrganizerQaRoots');resetBatchState();downloadDirectoryHandle=null;libraryDirectoryHandle=null;designerFolders=[];singlesPdfNames=[];
    designerAliases={};actionLogs=[];localStorage.removeItem(ALIAS_STORAGE_KEY);localStorage.removeItem(LOG_STORAGE_KEY);
    draftRevision=0;savedDraftRevision=0;pendingDraft=null;
    libraryCatalog=null;catalogRoot=null;catalogDiskText=null;catalogError='';indexedLibraryFiles=[];categoryEditorDirty=false;libraryCategoryDrafts.clear();libraryAttributeDrafts.clear();libraryPageDrafts.clear();renderCatalogUI();
    renderSortingRows();renderDownloadFileList();renderAliasList();renderActionLogs();
    draftSaveStatus.textContent='Select a folder to enable review autosave.';
  });
  async function updateReport() {
    if(downloadDirectoryHandle&&!fixtureDownloads)await recoverFixtureHandle();
    let draft;
    try { draft = await ReviewDraftStore.load(); } catch {}
    const existing=[];
    if (fixtureDownloads) {try {for await(const entry of fixtureDownloads.values())existing.push(entry.name);}catch{}}
    report.textContent = JSON.stringify({
      error:lastError,current:downloadFiles.length,queued:queuedDownloadFiles.length,deferred:deferredDownloadFiles.length,
      selected:selectedReviewName,detailCount:document.querySelectorAll('#sortingList .sort-row').length,
      reads:checkProgress.reads,checked:duplicateCheckComplete,sourceCount:existing.length,
      storedVersion:draft?.version,storedCount:draft?.files?.length,
      storedCurrent:draft?.files?.filter(file=>file.role==='current').length,
      pending100:queuedDownloadFiles.find(file=>file.name.includes('_100'))?.patternFileName,
      lastPendingName:queuedDownloadFiles.at(-1)?.patternFileName,
      completedMoves:actionLogs[0]?.moved?.length,
      deferredNames:deferredDownloadFiles.map(file=>file.name),
      catalog:libraryCatalog?{revision:libraryCatalog.revision,categories:libraryCatalog.categories.map(c=>({id:c.id,name:c.name})),patterns:libraryCatalog.patterns.filter(p=>p.present).slice(0,6)}:null,
      selectedCategories:downloadFiles.find(f=>f.name===selectedReviewName)?.categoryIds,
      savedSelectedCategories:draft?.files?.find(f=>f.name===selectedReviewName)?.categoryIds,
      catalogError,
      galleryTotal:libraryCatalog?.patterns.filter(p=>p.present).length||0,
      galleryCards:document.querySelectorAll('.library-pattern').length,
      previewStats:GalleryPreviews.stats,pdfStats:PdfPreview.stats,
      analysisRunning:Boolean(analysisRun),maintenanceHashReads,maintenance:libraryCatalog?.patterns.map(p=>({id:p.id,path:p.path,present:p.present,mergedInto:p.mergedInto,source:p.categorySource,categories:p.categoryIds,page:p.representativePage,sha256:p.sha256,analysis:p.analysis}))||[],
      representatives:libraryCatalog?.patterns.filter(p=>p.present&&p.representativePage>1).map(p=>({id:p.id,path:p.path,page:p.representativePage}))||[]
    },null,2);
  }
  setInterval(updateReport,500);
  updateReport();
})();
