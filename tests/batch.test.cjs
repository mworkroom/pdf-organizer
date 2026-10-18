const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const context = vm.createContext({
    BATCH_LIMIT: 100, REVIEW_FIELDS: ['excluded', 'patternFileName', 'specialFolderKey'],
    downloadFiles: [], queuedDownloadFiles: [], deferredDownloadFiles: [],
    selectedReviewName: '', reviewSelections: new Set(), batchNumber: 1, batchInitialized: false,
    setActiveView(view) { context.view = view; },
    console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/batch.js'), 'utf8'), context);
  return context;
}
function files(count) {
  return Array.from({ length: count }, (_, i) => ({name:`file-${i}.pdf`,size:i,lastModified:1,excluded:false,patternFileName:`manual-${i}.pdf`,specialFolderKey:'scarves'}));
}

test('v1 recovery keeps all 400 edits and caps current batch at 100', () => {
  const state = load();
  const migrated = state.normalizeReviewDraft({version:1,files:files(400)});
  assert.equal(migrated.files.filter(file=>file.role==='current').length,100);
  assert.equal(migrated.files.filter(file=>file.role==='queued').length,300);
  assert.equal(migrated.files[399].patternFileName,'manual-399.pdf');
  assert.equal(migrated.files[0].specialFolderKey,'singles');
});

test('malformed v2 drafts cannot silently grow the active batch or lose duplicate filenames', () => {
  const state=load();
  assert.throws(()=>state.normalizeReviewDraft({version:2,files:files(101).map(file=>({...file,role:'current'}))}),/100/);
  assert.throws(()=>state.normalizeReviewDraft({version:2,files:[{name:'a.pdf',role:'current'},{name:'a.pdf',role:'queued'}]}),/saved review/);
  assert.throws(()=>state.normalizeReviewDraft({version:2,files:[{name:'a.pdf',role:'missing'}]}),/batch/);
});

test('restore preserves frozen membership; new files join waiting queue', () => {
  const state=load();
  state.restoreBatchMembership(files(5),{version:2,files:[{name:'file-2.pdf',role:'current'},{name:'file-0.pdf',role:'queued'},{name:'file-1.pdf',role:'deferred',deferredReason:'On hold'}],selectedReviewName:'file-2.pdf',selections:['file-2.pdf','missing.pdf'],batchNumber:3});
  assert.deepEqual(Array.from(state.downloadFiles,file=>file.name),['file-2.pdf']);
  assert.deepEqual(Array.from(state.queuedDownloadFiles,file=>file.name),['file-0.pdf','file-3.pdf','file-4.pdf']);
  assert.equal(state.deferredDownloadFiles[0].deferredReason,'On hold');
  assert.equal(state.reviewSelections.size,1);
});

test('resume opens all 52 deferred reviews with edits and exclusions intact', () => {
  const state=load(),records=files(52);
  records[0].excluded=true;records[0].categoryIds=['cardigan'];records[0].attributeIds=['texture'];records[0].patternId='stable-id';
  const draft={version:2,batchNumber:2,files:records.map(file=>({...file,role:'deferred',deferredReason:'On hold'}))};
  const resumed=state.restoreBatchMembership(records,draft);
  assert.equal(resumed.reopenedFrom,'deferred');assert.equal(resumed.excluded,1);
  assert.equal(state.downloadFiles.length,52);assert.equal(state.deferredDownloadFiles.length,0);
  assert.equal(state.queuedDownloadFiles.length,0);assert.equal(state.batchNumber,2);
  assert.equal(state.downloadFiles[0],records[0]);assert.equal(records[0].excluded,true);
  assert.equal(records[0].patternFileName,'manual-0.pdf');assert.equal(records[0].patternId,'stable-id');
  assert.deepEqual(records[0].categoryIds,['cardigan']);assert.deepEqual(records[0].attributeIds,['texture']);
  assert.equal(records[0].analysis.action,'unchecked');assert.equal(state.selectedReviewName,'file-0.pdf');
});

test('resume caps deferred work at 100 and does not expand a restored current batch', () => {
  const state=load(),records=files(152).map(file=>({...file,excluded:true}));
  state.restoreBatchMembership(records,{version:2,files:records.map(file=>({...file,role:'deferred'}))});
  assert.equal(state.downloadFiles.length,100);assert.equal(state.deferredDownloadFiles.length,52);
  assert.equal(state.downloadFiles.every(file=>file.excluded),true);
  const snapshot={version:2,files:state.serializeBatchFiles()};
  const resumed=state.restoreBatchMembership(records,snapshot);
  assert.equal(resumed.reopenedFrom,'');assert.equal(state.downloadFiles.length,100);
  assert.equal(state.deferredDownloadFiles.length,52);
});

test('resume prioritizes queued files, skips missing files and leaves deferred work separate', () => {
  const state=load(),records=files(3);
  state.restoreBatchMembership(records,{version:2,files:[
    {name:'missing.pdf',role:'current'},{name:'file-0.pdf',role:'deferred'},
    {name:'file-1.pdf',role:'queued'},{name:'file-2.pdf',role:'queued'}
  ]});
  assert.deepEqual(Array.from(state.downloadFiles,file=>file.name),['file-1.pdf','file-2.pdf']);
  assert.deepEqual(Array.from(state.deferredDownloadFiles,file=>file.name),['file-0.pdf']);
  assert.equal(state.queuedDownloadFiles.length,0);
});

test('completed work defers held/excluded files and never adds them to the next queue', () => {
  const state=load();
  state.downloadFiles=[{name:'done.pdf',completed:true},{name:'hold.pdf',analysis:{action:'hold',message:'충돌'}},{name:'skip.pdf',excluded:true,analysis:{action:'excluded'}}];
  state.queuedDownloadFiles=[{name:'next.pdf'}];
  state.finishCurrentBatch();
  assert.equal(state.downloadFiles.length,0);
  assert.deepEqual(Array.from(state.deferredDownloadFiles,file=>file.name),['hold.pdf','skip.pdf']);
  assert.equal(state.queuedDownloadFiles[0].name,'next.pdf');
});

test('operation limit guards both batch operations independently of UI', () => {
  const state=load();state.downloadFiles=files(101);
  assert.throws(()=>state.assertBatchLimit(),/100/);
  state.downloadFiles=files(100);assert.doesNotThrow(()=>state.assertBatchLimit());
});

test('deferring an entirely excluded batch leaves the waiting queue untouched', async () => {
  const state=load();state.operationBusy=false;
  state.setOperationBusy=busy=>state.operationBusy=busy;
  state.saveReviewDraft=async()=>{};state.scheduleDraftSave=()=>{};
  state.renderDownloadFileList=()=>{};state.renderSortingRows=()=>{};
  state.executeStatus={};state.downloadFiles=files(100).map(file=>({...file,excluded:true}));
  state.queuedDownloadFiles=files(200).slice(100);
  await state.deferCurrentBatch();
  assert.equal(state.downloadFiles.length,0);
  assert.equal(state.deferredDownloadFiles.length,100);
  assert.equal(state.queuedDownloadFiles.length,100);
  assert.equal(state.operationBusy,false);
});

test('failed deferral save restores the current batch and selected files', async () => {
  const state=load();state.operationBusy=false;
  state.setOperationBusy=busy=>state.operationBusy=busy;
  let saves=0;state.saveReviewDraft=async()=>{if(++saves===2)throw new Error('storage full');};
  state.scheduleDraftSave=()=>{};state.renderDownloadFileList=()=>{};state.renderSortingRows=()=>{};
  state.executeStatus={};state.downloadFiles=files(100).map(file=>({...file,excluded:true}));
  state.selectedReviewName='file-5.pdf';state.reviewSelections=new Set(['file-5.pdf']);
  await state.deferCurrentBatch();
  assert.equal(state.downloadFiles.length,100);assert.equal(state.deferredDownloadFiles.length,0);
  assert.equal(state.selectedReviewName,'file-5.pdf');assert.equal(state.reviewSelections.has('file-5.pdf'),true);
  assert.match(state.executeStatus.textContent,/storage full/);
});
