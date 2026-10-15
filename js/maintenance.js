let analysisRun=null,maintenanceMessage='',repairMissingId='',repairCandidateId='',repairProof=null,maintenanceHashReads=0;
function resetMaintenance(){repairMissingId='';repairCandidateId='';repairProof=null;maintenanceMessage='';}

function maintenanceReady(){
  if(!libraryCatalog||catalogError)throw new Error(catalogError||'Connect a pattern folder.');
  if(hasPendingLibraryEdits())throw new Error('Save or cancel category, attribute and cover page edits first.');
}
function maintenanceStatus(message){
  maintenanceMessage=message;
  const status=document.getElementById('maintenanceStatus');if(status)status.textContent=message;
}
function missingPatterns(){return libraryCatalog?.patterns.filter(p=>!p.present&&!p.mergedInto)||[];}
function renderMaintenanceControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  document.querySelectorAll('[data-maintenance-control]').forEach(control=>control.disabled=disabled);
  const pause=document.getElementById('pauseAnalysisButton');if(pause)pause.disabled=!analysisRun||analysisRun.controller.signal.aborted;
}
function renderMaintenance(){
  const host=document.getElementById('maintenanceContent');if(!host)return;
  const current=libraryCatalog?.patterns.filter(p=>p.present)||[];
  host.innerHTML='<p class="note">Analyzes up to the first 3 pages of each organized PDF, one file at a time. Only clear titles are used for automatic classification; manual categories and attributes are preserved. Scanned PDFs without text are not processed with OCR.</p><p id="analysisSummary" class="note"></p><div class="maintenance-actions"><button id="startAnalysisButton" type="button" data-maintenance-control>Analyze remaining PDFs / resume</button><button id="retryAnalysisButton" type="button" class="secondary-button" data-maintenance-control>Retry failed PDFs</button><button id="pauseAnalysisButton" type="button" class="secondary-button" disabled>Pause analysis</button></div><p id="maintenanceStatus" class="note" role="status" aria-live="polite"></p><hr><h3>Relink PDFs moved or renamed outside the app</h3><p class="note">Refresh the library, then select a candidate with the same size as the missing pattern. Only the selected candidate is read to verify its hash. If no saved hash exists, check the file contents manually before relinking. Original PDFs are not moved or deleted.</p><div class="repair-fields"><label>Previous pattern<select id="repairMissing" class="text-input" data-maintenance-control></select></label><label>Current file candidate<select id="repairCandidate" class="text-input" data-maintenance-control></select></label></div><p id="repairEvidence" class="note" role="status"></p><label class="repair-confirm"><input id="repairConsent" type="checkbox" data-maintenance-control>I have checked that the previous pattern and the selected candidate are the same pattern.</label><div class="maintenance-actions"><button id="checkRepairButton" type="button" class="secondary-button" data-maintenance-control>Verify candidate hash</button><button id="applyRepairButton" type="button" data-maintenance-control>Save link to selected file</button></div>';
  document.getElementById('analysisSummary').textContent=`Total: ${current.length} · Pending: ${current.filter(p=>!p.analysis).length} · Analyzed: ${current.filter(p=>p.analysis&&p.analysis.status!=='error').length} · Failed: ${current.filter(p=>p.analysis?.status==='error').length}`;
  document.getElementById('maintenanceStatus').textContent=maintenanceMessage;
  document.getElementById('startAnalysisButton').onclick=()=>runTextAnalysis(false);
  document.getElementById('retryAnalysisButton').onclick=()=>runTextAnalysis(true);
  document.getElementById('pauseAnalysisButton').onclick=()=>{analysisRun?.controller.abort();maintenanceStatus('Pausing. Saved analysis results are preserved.');renderMaintenanceControls();};
  const missing=document.getElementById('repairMissing'),items=missingPatterns();
  missing.add(new Option(items.length?'Select a previous pattern': 'No missing patterns',''));
  for(const p of items)missing.add(new Option(`${p.path} · ${p.categoryIds.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(', ')}`,p.id));
  if(!items.some(p=>p.id===repairMissingId)){repairMissingId='';repairCandidateId='';repairProof=null;}
  missing.value=repairMissingId;
  missing.onchange=()=>{repairMissingId=missing.value;repairCandidateId='';repairProof=null;populateRepairCandidates();};
  document.getElementById('repairCandidate').onchange=event=>{repairCandidateId=event.target.value;repairProof=null;renderRepairEvidence();};
  document.getElementById('checkRepairButton').onclick=()=>repairAction(false);
  const open=document.createElement('button');open.id='openRepairPdfButton';open.type='button';open.className='secondary-button';open.dataset.maintenanceControl='';open.textContent='Open candidate PDF';
  document.getElementById('checkRepairButton').before(open);
  open.onclick=()=>{const candidate=libraryCatalog?.patterns.find(p=>p.id===repairCandidateId&&p.present),file=indexedLibraryFiles.find(f=>f.path===candidate?.path);if(file)openReviewPdf(file);else maintenanceStatus('Select a current file candidate first.');};
  document.getElementById('applyRepairButton').onclick=()=>repairAction(true);
  populateRepairCandidates();renderMaintenanceControls();
}
function populateRepairCandidates(){
  const select=document.getElementById('repairCandidate');select.replaceChildren(new Option('Select a current file',''));
  const old=libraryCatalog?.patterns.find(p=>p.id===repairMissingId);
  const candidates=old?MaintenanceModel.candidates(libraryCatalog,old):[];
  for(const p of candidates)select.add(new Option(`${p.path}${CatalogModel.hasManualClassification(p)?' · Has manual categories or attributes':''}`,p.id));
  if(!candidates.some(p=>p.id===repairCandidateId))repairCandidateId='';select.value=repairCandidateId;
  renderRepairEvidence();
}
function renderRepairEvidence(){
  const old=libraryCatalog?.patterns.find(p=>p.id===repairMissingId),candidate=libraryCatalog?.patterns.find(p=>p.id===repairCandidateId);
  document.getElementById('repairConsent').checked=false;
  const evidence=document.getElementById('repairEvidence');
  evidence.textContent=!old?'Select a previous pattern to recover.':!candidate?`Previous file: ${old.size.toLocaleString('en-GB')} bytes · Same-size candidates: ${MaintenanceModel.candidates(libraryCatalog,old).length}. If none are available, check the original file or a separate backup.`:CatalogModel.hasManualClassification(candidate)?'Relinking is blocked because the candidate has manual categories or attributes. Check both patterns before continuing.':repairProof?(old.sha256?(repairProof.hash===old.sha256?'SHA-256 match. Check the contents, then save the link.':'SHA-256 mismatch. This candidate cannot be linked.'):'No previous hash. File identity cannot be verified automatically. Relink only after checking the original contents manually.'):'Only the file size matches so far. Select Verify candidate hash first.';
  if(old&&candidate)evidence.textContent=`Previous: ${old.path} → Current: ${candidate.path} · ${evidence.textContent}`;
}
async function checkedLibraryFile(pattern){
  let directory=libraryDirectoryHandle;const parts=pattern.path.split('/');
  for(const name of parts.slice(0,-1))directory=await directory.getDirectoryHandle(name);
  const handle=await directory.getFileHandle(parts.at(-1)),file=await handle.getFile();
  if(file.size!==pattern.size||file.lastModified!==pattern.lastModified)throw new Error('The file has changed. Refresh the library.');
  const indexed=indexedLibraryFiles.find(f=>f.path===pattern.path);
  if(!indexed||!await handle.isSameEntry(indexed.handle))throw new Error('The file link has changed. Refresh the library.');
  return {handle,file};
}
async function hashLibraryFile(pattern){
  const {file}=await checkedLibraryFile(pattern),bytes=await file.arrayBuffer();
  maintenanceHashReads++;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  await checkedLibraryFile(pattern);return hash;
}
async function runTextAnalysis(retry){
  if(operationBusy||draftLockedElsewhere)return;
  try{maintenanceReady();}catch(error){maintenanceStatus(error.message);return;}
  const ids=libraryCatalog.patterns.filter(p=>p.present&&(retry?p.analysis?.status==='error':!p.analysis)).map(p=>p.id);
  if(!ids.length){maintenanceStatus(retry?'No failed PDFs to retry.':'No PDFs awaiting analysis.');return;}
  analysisRun={controller:new AbortController(),completed:0,total:ids.length};
  const run=analysisRun;GalleryPreviews.suspend();setOperationBusy(true);renderMaintenanceControls();
  try{
    for(const id of ids){
      if(run.controller.signal.aborted)break;
      const pattern=libraryCatalog.patterns.find(p=>p.id===id);
      maintenanceStatus(`Text analysis: ${run.completed} / ${run.total} · ${pattern.path}`);
      let updated;
      try{
        const {handle}=await checkedLibraryFile(pattern);
        const result=await PdfPreview.extractText(handle,pattern,run.controller.signal);
        if(run.controller.signal.aborted)break;
        await checkedLibraryFile(pattern);
        updated=MaintenanceModel.applyAnalysis(pattern,result,libraryCatalog.categories);
      }catch(error){
        if(run.controller.signal.aborted)break;
        updated={...pattern,analysis:{version:1,status:'error',pages:0,matches:[],at:new Date().toISOString(),error:analysisError(error)}};
      }
      // Commit each PDF separately. A failed JSON write leaves this and remaining PDFs resumable.
      const next=structuredClone(libraryCatalog);next.patterns[next.patterns.findIndex(p=>p.id===id)]=updated;
      await persistCatalog(next);run.completed++;
    }
    maintenanceStatus(`${run.controller.signal.aborted?'Pause analysis':'Analysis complete'} · Saved ${run.completed} / ${run.total} in this run. Resume to analyze the remaining PDFs.`);
  }catch(error){maintenanceStatus(`Analysis stopped · ${run.completed} saved: ${error.message}`);}
  finally{analysisRun=null;setOperationBusy(false);renderCatalogUI();}
}
function analysisError(error){
  if(error.name==='PasswordException')return 'This PDF requires a password. Check the original file for its password.';
  if(error.name==='InvalidPDFException')return 'Could not read the PDF. Check the original file.';
  return String(error.message||'Could not read PDF').slice(0,240);
}
async function repairAction(apply){
  if(operationBusy||draftLockedElsewhere)return;
  let old,candidate;
  try{
    maintenanceReady();old=libraryCatalog.patterns.find(p=>p.id===repairMissingId);candidate=libraryCatalog.patterns.find(p=>p.id===repairCandidateId);
    if(!old||old.present||!candidate?.present)throw new Error('Select a previous pattern and a current candidate.');
    if(CatalogModel.hasManualClassification(candidate))throw new Error('Check the candidate file’s manual categories or attributes first.');
    if(apply&&(!repairProof||repairProof.libraryId!==libraryCatalog.libraryId||repairProof.old!==old.id||repairProof.candidate!==candidate.id))throw new Error('Select Verify candidate hash first.');
    if(apply&&(!document.getElementById('repairConsent').checked))throw new Error('Check that both files are the same pattern, then select the confirmation checkbox.');
    if(apply&&old.sha256&&old.sha256!==repairProof.hash)throw new Error('The file does not match the saved hash.');
  }catch(error){maintenanceStatus(error.message);return;}
  GalleryPreviews.suspend();setOperationBusy(true);
  try{
    maintenanceStatus('Reading the selected candidate file...');
    const hash=await hashLibraryFile(candidate);
    if(!apply){repairProof={libraryId:libraryCatalog.libraryId,old:old.id,candidate:candidate.id,hash};renderRepairEvidence();maintenanceStatus('Candidate verified. Review the result and file paths.');}
    else{
      if(hash!==repairProof.hash)throw new Error('The candidate contents changed after verification. Refresh the library.');
      if(old.path!==candidate.path){
        try{let dir=libraryDirectoryHandle;const parts=old.path.split('/');for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);await dir.getFileHandle(parts.at(-1));throw new Error('A file has reappeared at the previous path. Refresh the library.');}
        catch(error){if(error.name!=='NotFoundError')throw error;}
      }
      const next=MaintenanceModel.relink(libraryCatalog,old.id,candidate.id,hash,Boolean(old.sha256));
      await persistCatalog(next);repairProof=null;repairMissingId='';repairCandidateId='';
      maintenanceStatus('Link saved. The previous pattern ID, categories, and cover page are preserved.');renderCatalogUI();
    }
  }catch(error){maintenanceStatus(`Relinking failed: ${error.message}`);}
  finally{setOperationBusy(false);renderMaintenanceControls();GalleryPreviews.resume();}
}
function initializeMaintenanceControls(){renderMaintenance();}
