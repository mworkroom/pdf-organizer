let analysisRun=null,maintenanceMessage='',repairMissingId='',repairCandidateId='',repairProof=null,maintenanceHashReads=0;
function resetMaintenance(){repairMissingId='';repairCandidateId='';repairProof=null;maintenanceMessage='';}

function maintenanceReady(){
  if(!libraryCatalog||catalogError)throw new Error(catalogError||'패턴 폴더를 연결하세요.');
  if(categoryEditorDirty||libraryCategoryDrafts.size||libraryPageDrafts.size)throw new Error('편집 중인 분류·대표 페이지를 먼저 저장하거나 취소하세요.');
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
  host.innerHTML='<p class="note">정리된 PDF의 첫 3페이지를 한 파일씩 분석합니다. 확실한 제목만 자동 분류에 사용하며 수동 분류는 유지합니다. 텍스트가 없는 스캔 PDF에는 OCR을 적용하지 않습니다.</p><p id="analysisSummary" class="note"></p><div class="maintenance-actions"><button id="startAnalysisButton" type="button" data-maintenance-control>미분석 PDF 분석 · 이어서</button><button id="retryAnalysisButton" type="button" class="secondary-button" data-maintenance-control>실패한 PDF 다시 분석</button><button id="pauseAnalysisButton" type="button" class="secondary-button" disabled>분석 일시정지</button></div><p id="maintenanceStatus" class="note" role="status" aria-live="polite"></p><hr><h3>외부에서 이동·이름 변경한 PDF 연결</h3><p class="note">패턴 목록을 새로고침한 뒤 사라진 도안과 같은 크기의 후보를 선택하세요. 선택한 후보만 읽어 해시를 확인합니다. 저장된 해시가 없으면 파일 내용을 직접 확인한 뒤 연결할 수 있습니다. 원본 PDF는 이동하거나 삭제하지 않습니다.</p><div class="repair-fields"><label>이전 도안<select id="repairMissing" class="text-input" data-maintenance-control></select></label><label>현재 파일 후보<select id="repairCandidate" class="text-input" data-maintenance-control></select></label></div><p id="repairEvidence" class="note" role="status"></p><label class="repair-confirm"><input id="repairConsent" type="checkbox" data-maintenance-control>이전 도안과 선택한 후보가 같은 도안임을 직접 확인했습니다.</label><div class="maintenance-actions"><button id="checkRepairButton" type="button" class="secondary-button" data-maintenance-control>선택 후보 해시 확인</button><button id="applyRepairButton" type="button" data-maintenance-control>선택한 파일로 연결 저장</button></div>';
  document.getElementById('analysisSummary').textContent=`전체 ${current.length}개 · 미분석 ${current.filter(p=>!p.analysis).length}개 · 분석됨 ${current.filter(p=>p.analysis&&p.analysis.status!=='error').length}개 · 실패 ${current.filter(p=>p.analysis?.status==='error').length}개`;
  document.getElementById('maintenanceStatus').textContent=maintenanceMessage;
  document.getElementById('startAnalysisButton').onclick=()=>runTextAnalysis(false);
  document.getElementById('retryAnalysisButton').onclick=()=>runTextAnalysis(true);
  document.getElementById('pauseAnalysisButton').onclick=()=>{analysisRun?.controller.abort();maintenanceStatus('일시정지 중 · 저장이 끝난 도안은 유지됩니다.');renderMaintenanceControls();};
  const missing=document.getElementById('repairMissing'),items=missingPatterns();
  missing.add(new Option(items.length?'이전 도안 선택': '사라진 도안 없음',''));
  for(const p of items)missing.add(new Option(`${p.path} · ${p.categoryIds.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(', ')}`,p.id));
  if(!items.some(p=>p.id===repairMissingId)){repairMissingId='';repairCandidateId='';repairProof=null;}
  missing.value=repairMissingId;
  missing.onchange=()=>{repairMissingId=missing.value;repairCandidateId='';repairProof=null;populateRepairCandidates();};
  document.getElementById('repairCandidate').onchange=event=>{repairCandidateId=event.target.value;repairProof=null;renderRepairEvidence();};
  document.getElementById('checkRepairButton').onclick=()=>repairAction(false);
  const open=document.createElement('button');open.id='openRepairPdfButton';open.type='button';open.className='secondary-button';open.dataset.maintenanceControl='';open.textContent='후보 PDF 열기';
  document.getElementById('checkRepairButton').before(open);
  open.onclick=()=>{const candidate=libraryCatalog?.patterns.find(p=>p.id===repairCandidateId&&p.present),file=indexedLibraryFiles.find(f=>f.path===candidate?.path);if(file)openReviewPdf(file);else maintenanceStatus('먼저 현재 파일 후보를 선택하세요.');};
  document.getElementById('applyRepairButton').onclick=()=>repairAction(true);
  populateRepairCandidates();renderMaintenanceControls();
}
function populateRepairCandidates(){
  const select=document.getElementById('repairCandidate');select.replaceChildren(new Option('현재 파일 선택',''));
  const old=libraryCatalog?.patterns.find(p=>p.id===repairMissingId);
  const candidates=old?MaintenanceModel.candidates(libraryCatalog,old):[];
  for(const p of candidates)select.add(new Option(`${p.path}${p.categorySource==='manual'?' · 수동 분류 있음':''}`,p.id));
  if(!candidates.some(p=>p.id===repairCandidateId))repairCandidateId='';select.value=repairCandidateId;
  renderRepairEvidence();
}
function renderRepairEvidence(){
  const old=libraryCatalog?.patterns.find(p=>p.id===repairMissingId),candidate=libraryCatalog?.patterns.find(p=>p.id===repairCandidateId);
  document.getElementById('repairConsent').checked=false;
  const evidence=document.getElementById('repairEvidence');
  evidence.textContent=!old?'복구할 이전 도안을 선택하세요.':!candidate?`이전 파일 ${old.size.toLocaleString()} bytes · 같은 크기 후보 ${MaintenanceModel.candidates(libraryCatalog,old).length}개. 후보가 없으면 원본 파일이나 별도 백업을 확인하세요.`:candidate.categorySource==='manual'?'후보 파일에 수동 분류가 있어 연결을 막았습니다. 두 도안의 분류를 먼저 확인하세요.':repairProof?(old.sha256?(repairProof.hash===old.sha256?'SHA-256 일치 · 내용을 확인한 뒤 연결을 저장하세요.':'SHA-256 불일치 · 이 후보로 연결할 수 없습니다.'):'이전 해시 없음 · 동일한 파일인지 자동 검증할 수 없습니다. 원본 내용을 직접 확인한 경우에만 연결하세요.'):'파일 크기만 같은 후보입니다. 먼저 선택 후보 해시 확인을 눌러주세요.';
  if(old&&candidate)evidence.textContent=`이전: ${old.path} → 현재: ${candidate.path} · ${evidence.textContent}`;
}
async function checkedLibraryFile(pattern){
  let directory=libraryDirectoryHandle;const parts=pattern.path.split('/');
  for(const name of parts.slice(0,-1))directory=await directory.getDirectoryHandle(name);
  const handle=await directory.getFileHandle(parts.at(-1)),file=await handle.getFile();
  if(file.size!==pattern.size||file.lastModified!==pattern.lastModified)throw new Error('파일이 변경됐습니다. 패턴 목록을 새로고침하세요.');
  const indexed=indexedLibraryFiles.find(f=>f.path===pattern.path);
  if(!indexed||!await handle.isSameEntry(indexed.handle))throw new Error('파일 연결이 변경됐습니다. 패턴 목록을 새로고침하세요.');
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
  if(!ids.length){maintenanceStatus(retry?'다시 분석할 실패 PDF가 없습니다.':'미분석 PDF가 없습니다.');return;}
  analysisRun={controller:new AbortController(),completed:0,total:ids.length};
  const run=analysisRun;GalleryPreviews.suspend();setOperationBusy(true);renderMaintenanceControls();
  try{
    for(const id of ids){
      if(run.controller.signal.aborted)break;
      const pattern=libraryCatalog.patterns.find(p=>p.id===id);
      maintenanceStatus(`텍스트 분석 ${run.completed} / ${run.total}개 · ${pattern.path}`);
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
    maintenanceStatus(`${run.controller.signal.aborted?'분석 일시정지':'분석 완료'} · 이번 작업 ${run.completed} / ${run.total}개 저장됨. 미분석은 이어서 처리할 수 있습니다.`);
  }catch(error){maintenanceStatus(`분석 중단 · ${run.completed}개 저장됨: ${error.message}`);}
  finally{analysisRun=null;setOperationBusy(false);renderCatalogUI();}
}
function analysisError(error){
  if(error.name==='PasswordException')return '암호가 필요한 PDF입니다. 원본에서 암호를 확인하세요.';
  if(error.name==='InvalidPDFException')return 'PDF를 읽을 수 없습니다. 원본 파일을 확인하세요.';
  return String(error.message||'PDF 읽기 실패').slice(0,240);
}
async function repairAction(apply){
  if(operationBusy||draftLockedElsewhere)return;
  let old,candidate;
  try{
    maintenanceReady();old=libraryCatalog.patterns.find(p=>p.id===repairMissingId);candidate=libraryCatalog.patterns.find(p=>p.id===repairCandidateId);
    if(!old||old.present||!candidate?.present)throw new Error('이전 도안과 현재 후보를 선택하세요.');
    if(candidate.categorySource==='manual')throw new Error('후보 파일의 수동 분류를 먼저 확인하세요.');
    if(apply&&(!repairProof||repairProof.libraryId!==libraryCatalog.libraryId||repairProof.old!==old.id||repairProof.candidate!==candidate.id))throw new Error('먼저 선택 후보 해시 확인을 눌러주세요.');
    if(apply&&(!document.getElementById('repairConsent').checked))throw new Error('동일한 도안인지 확인한 뒤 확인란을 선택하세요.');
    if(apply&&old.sha256&&old.sha256!==repairProof.hash)throw new Error('저장된 해시와 일치하지 않는 파일입니다.');
  }catch(error){maintenanceStatus(error.message);return;}
  GalleryPreviews.suspend();setOperationBusy(true);
  try{
    maintenanceStatus('선택한 후보 파일만 읽는 중...');
    const hash=await hashLibraryFile(candidate);
    if(!apply){repairProof={libraryId:libraryCatalog.libraryId,old:old.id,candidate:candidate.id,hash};renderRepairEvidence();maintenanceStatus('후보 확인을 마쳤습니다. 확인 결과와 경로를 검토하세요.');}
    else{
      if(hash!==repairProof.hash)throw new Error('확인 이후 후보 내용이 변경됐습니다. 목록을 새로고침하세요.');
      if(old.path!==candidate.path){
        try{let dir=libraryDirectoryHandle;const parts=old.path.split('/');for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);await dir.getFileHandle(parts.at(-1));throw new Error('이전 경로에 파일이 다시 나타났습니다. 목록을 새로고침하세요.');}
        catch(error){if(error.name!=='NotFoundError')throw error;}
      }
      const next=MaintenanceModel.relink(libraryCatalog,old.id,candidate.id,hash,Boolean(old.sha256));
      await persistCatalog(next);repairProof=null;repairMissingId='';repairCandidateId='';
      maintenanceStatus('연결 저장 완료 · 이전 도안 ID·분류·대표 페이지를 유지했습니다.');renderCatalogUI();
    }
  }catch(error){maintenanceStatus(`연결 작업 실패: ${error.message}`);}
  finally{setOperationBusy(false);renderMaintenanceControls();GalleryPreviews.resume();}
}
function initializeMaintenanceControls(){renderMaintenance();}
