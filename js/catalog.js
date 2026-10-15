const CATALOG_FILE_NAME='!pdf-organizer-library.json';
const CATALOG_BACKUP_NAME='!pdf-organizer-library.backup.json';
let libraryCatalog=null, catalogRoot=null, catalogDiskText=null, catalogError='';
let indexedLibraryFiles=[], libraryPage=0;
let categoryEditorDirty=false;
const libraryCategoryDrafts=new Map();
const defaultCategories=CatalogModel.create().categories;

function availableCategories(){return libraryCatalog?.categories || defaultCategories;}
function setCatalogStatus(message){document.getElementById('catalogStatus').textContent=message;}
async function readCatalogText(root){
  try{return await (await root.getFileHandle(CATALOG_FILE_NAME)).getFile().then(file=>file.text());}
  catch(error){if(error.name==='NotFoundError')return null;throw error;}
}
async function writeCatalogText(root,name,text){
  const handle=await root.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{await writable.write(text);await writable.close();}
  catch(error){try{await writable.abort();}catch{}throw error;}
}
async function persistCatalog(next){
  if(!libraryCatalog||catalogError||!catalogRoot||!await catalogRoot.isSameEntry(libraryDirectoryHandle))throw new Error(catalogError||'패턴 폴더의 메타데이터를 먼저 연결하세요.');
  CatalogModel.validate(next);
  // Compare the exact disk snapshot, so another app/tab cannot silently lose changes.
  const current=await readCatalogText(catalogRoot);
  if(current!==catalogDiskText)throw new Error('다른 곳에서 메타데이터가 변경되었습니다. 패턴 목록 새로고침 후 다시 시도하세요.');
  next.revision=libraryCatalog.revision+1;next.updatedAt=new Date().toISOString();
  const text=JSON.stringify(next,null,2)+'\n';
  if(current!==null)await writeCatalogText(catalogRoot,CATALOG_BACKUP_NAME,current);
  await writeCatalogText(catalogRoot,CATALOG_FILE_NAME,text);
  libraryCatalog=next;catalogDiskText=text;
  setCatalogStatus(`메타데이터 저장됨 · PDF ${next.patterns.filter(p=>p.present).length}개 · 카테고리 ${next.categories.length}개`);
}
async function loadLibraryCatalog(){
  const root=libraryDirectoryHandle;
  if(categoryEditorDirty||libraryCategoryDrafts.size||libraryPageDrafts.size)throw new Error('편집 중인 분류·대표 페이지를 먼저 저장하거나 취소한 뒤 목록을 새로 연결하세요.');
  if(typeof resetMaintenance==='function')resetMaintenance();
  libraryCatalog=null;indexedLibraryFiles=[];catalogRoot=root;catalogError='';
  setCatalogStatus('패턴 목록과 메타데이터를 확인하는 중...');
  try{
    catalogDiskText=await readCatalogText(root);
    libraryCatalog=catalogDiskText===null?CatalogModel.create():CatalogModel.validate(JSON.parse(catalogDiskText));
    const files=[];
    async function walk(directory,prefix=''){
      for await(const entry of directory.values()){
        const path=prefix+entry.name;
        if(entry.kind==='directory')await walk(entry,path+'/');
        else if(entry.name.toLowerCase().endsWith('.pdf')){
          const metadata=await entry.getFile();
          files.push({path,name:entry.name,size:metadata.size,lastModified:metadata.lastModified,handle:entry});
        }
      }
    }
    await walk(root);
    files.sort((a,b)=>a.path.localeCompare(b.path,'ko'));
    const next=CatalogModel.reconcile(libraryCatalog,files);
    if(catalogDiskText===null||JSON.stringify(next)!==JSON.stringify(libraryCatalog))await persistCatalog(next);
    indexedLibraryFiles=files;
    setCatalogStatus(`메타데이터 저장됨 · PDF ${files.length}개 · 카테고리 ${libraryCatalog.categories.length}개`);
  }catch(error){
    libraryCatalog=null;catalogError=error.message;
    setCatalogStatus(`메타데이터 연결 실패: ${error.message} · 원본 JSON과 백업 파일을 확인하세요.`);
  }
  libraryPage=0;renderCatalogUI();
}
function inferReviewCategories(file){
  file.patternId ||= crypto.randomUUID();
  file.categoryIds=CatalogModel.categoryIds(file.categoryIds,availableCategories());
  if(file.categorySource!=='manual'){
    file.categoryIds=CatalogModel.infer(file.patternFileName||file.name,availableCategories());file.categorySource='filename';
  }
}
function categoryPicker(ids,onChange,label='카테고리'){
  const field=document.createElement('fieldset');field.className='category-picker';
  const legend=document.createElement('legend');legend.textContent=label;field.append(legend);
  let selected=CatalogModel.categoryIds(ids,availableCategories());
  for(const category of availableCategories()){
    const item=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');
    input.type='checkbox';input.value=category.id;input.checked=selected.includes(category.id);input.disabled=draftLockedElsewhere;
    name.textContent=category.name;item.append(input,name);field.append(item);
    input.addEventListener('change',()=>{
      if(category.id==='unknown'&&input.checked)selected=['unknown'];
      else selected=CatalogModel.categoryIds(input.checked?[...selected,category.id]:selected.filter(id=>id!==category.id),availableCategories());
      field.querySelectorAll('input').forEach(box=>box.checked=selected.includes(box.value));onChange([...selected]);
    });
  }
  return field;
}
function renderReviewCategories(file){
  inferReviewCategories(file);
  const section=document.createElement('div');section.className='review-categories';
  section.append(categoryPicker(file.categoryIds,ids=>{file.categoryIds=ids;file.categorySource='manual';scheduleDraftSave();section.querySelector('.note').textContent='수동 분류 · 재분석해도 유지됩니다.';},'카테고리 · 여러 개 선택 가능'));
  const hint=document.createElement('p');hint.className='note';hint.textContent=file.categorySource==='manual'?'수동 분류 · 재분석해도 유지됩니다.':'파일명 기준 자동 분류 · 불분명하면 Unknown';
  const reanalyze=document.createElement('button');reanalyze.type='button';reanalyze.className='secondary-button';reanalyze.textContent='파일명 다시 분석';
  reanalyze.addEventListener('click',()=>{
    if(file.categorySource==='manual'){hint.textContent='수동 분류를 유지했습니다.';return;}
    inferReviewCategories(file);renderSelectedFile();scheduleDraftSave();
  });
  section.append(hint,reanalyze);return section;
}
async function catalogAction(action){
  if(operationBusy||draftLockedElsewhere)return;
  setOperationBusy(true);setCatalogStatus('메타데이터 저장 중...');
  try{await action();scheduleDraftSave();await saveReviewDraft();}
  catch(error){setCatalogStatus(`메타데이터 작업 실패: ${error.message}`);}
  finally{setOperationBusy(false);renderCatalogUI();renderSortingRows();}
}
function renderCatalogControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  document.querySelectorAll('[data-catalog-control]').forEach(control=>control.disabled=disabled);
  document.getElementById('refreshLibraryButton').disabled=operationBusy||draftLockedElsewhere||!libraryDirectoryHandle;
  document.getElementById('applyBulkCategoriesButton').disabled=operationBusy||!reviewSelections.size;
  renderGalleryControls();
  if(typeof renderMaintenanceControls==='function')renderMaintenanceControls();
}
function renderCatalogUI(){
  renderCategoryManager();renderLibraryPatterns();
  if(typeof renderMaintenance==='function')renderMaintenance();
  const bulk=document.getElementById('bulkCategoryPicker');bulk.replaceChildren();
  let chosen=['unknown'];bulk.append(categoryPicker(chosen,ids=>chosen=ids,'선택 파일에 적용할 카테고리'));
  document.getElementById('applyBulkCategoriesButton').onclick=()=>{
    for(const file of downloadFiles.filter(file=>reviewSelections.has(file.name))){file.categoryIds=[...chosen];file.categorySource='manual';}
    renderSortingRows();scheduleDraftSave();
  };
  renderCatalogControls();
  if(operationBusy)setOperationBusy(true);
}
function categoryManagerDraft(){
  return [...document.querySelectorAll('.category-editor')].map(row=>({id:row.dataset.id,name:row.querySelector('.category-name').value.trim(),keywords:row.querySelector('.category-keywords').value.split(',').map(s=>s.trim()).filter(Boolean)}));
}
function renderCategoryManager(){
  if(categoryEditorDirty)return;
  const list=document.getElementById('categoryManagerList');list.replaceChildren();
  if(!libraryCatalog){list.innerHTML='<p class="empty">패턴 폴더를 연결하면 카테고리를 관리할 수 있습니다.</p>';return;}
  for(const [index,category] of libraryCatalog.categories.entries()){
    const row=document.createElement('div');row.className='category-editor';row.dataset.id=category.id;
    const name=document.createElement('input');name.className='text-input category-name';name.value=category.name;name.setAttribute('aria-label',`${category.name} 이름`);
    const keywords=document.createElement('input');keywords.className='text-input category-keywords';keywords.value=category.keywords.join(', ');keywords.setAttribute('aria-label',`${category.name} 추론 키워드`);keywords.placeholder='추론 키워드 · 쉼표로 구분';
    name.oninput=keywords.oninput=()=>{categoryEditorDirty=true;setCatalogStatus('카테고리 편집 중 · 변경 저장을 눌러주세요.');};
    // Other/Unknown are semantic fallbacks: editable labels, no inference keywords.
    keywords.readOnly=['other','unknown'].includes(category.id);
    const tools=document.createElement('div');tools.className='category-row-tools';
    for(const [label,offset] of [['위로',-1],['아래로',1]]){
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=label;button.setAttribute('aria-label',`${category.name} ${label}`);
      button.disabled=index+offset<0||index+offset>=libraryCatalog.categories.length;
      button.onclick=()=>{const rows=[...list.children];const target=rows[index+offset];if(target){if(offset<0)target.before(row);else target.after(row);categoryEditorDirty=true;refreshCategoryOrderButtons();}};
      tools.append(button);
    }
    const replacement=document.createElement('select');replacement.className='text-input';replacement.setAttribute('aria-label',`${category.name} 삭제 시 대체 카테고리`);
    for(const other of libraryCatalog.categories.filter(c=>c.id!==category.id)){const option=document.createElement('option');option.value=other.id;option.textContent=other.name;replacement.append(option);}replacement.value='unknown';
    const remove=document.createElement('button');remove.type='button';remove.className='secondary-button';remove.textContent='삭제';remove.setAttribute('aria-label',`${category.name} 삭제`);remove.disabled=['other','unknown'].includes(category.id);
    remove.onclick=()=>{
      if(operationBusy)return;
      const replacementId=replacement.value;
      if(!window.confirm(`${category.name}을 삭제하고 사용 중인 분류를 ${replacement.selectedOptions[0].textContent}(으)로 바꿀까요? 다른 편집 내용도 함께 저장됩니다.`))return;
      catalogAction(async()=>{
        const next=structuredClone(libraryCatalog);next.categories=categoryManagerDraft();CatalogModel.validate(next);
        CatalogModel.removeCategory(next,category.id,replacementId);await persistCatalog(next);
        categoryEditorDirty=false;
        for(const file of getAllReviewFiles()){if(file.categoryIds?.includes(category.id)){file.categoryIds=CatalogModel.categoryIds(file.categoryIds.map(id=>id===category.id?replacementId:id),next.categories);file.categorySource='manual';}}
        for(const [id,ids] of libraryCategoryDrafts)libraryCategoryDrafts.set(id,CatalogModel.categoryIds(ids.map(c=>c===category.id?replacementId:c),next.categories));
      });
    };
    tools.append(replacement,remove);row.append(name,keywords,tools);list.append(row);
  }
}
function refreshCategoryOrderButtons(){
  const rows=[...document.querySelectorAll('.category-editor')];
  rows.forEach((row,index)=>{
    const buttons=row.querySelectorAll('button');buttons[0].disabled=index===0;buttons[1].disabled=index===rows.length-1;
    buttons[0].onclick=()=>{if(row.previousElementSibling){row.previousElementSibling.before(row);categoryEditorDirty=true;refreshCategoryOrderButtons();}};
    buttons[1].onclick=()=>{if(row.nextElementSibling){row.nextElementSibling.after(row);categoryEditorDirty=true;refreshCategoryOrderButtons();}};
  });
}
function renderLibraryPatterns(){ renderGallery(); }
async function persistMovedPattern(plan,copiedFile,sha256){
  if(!libraryCatalog||catalogError)throw new Error(catalogError||'메타데이터를 사용할 수 없습니다.');
  const next=structuredClone(libraryCatalog);
  const isIncoming=await plan.sourceDirectory.isSameEntry(downloadDirectoryHandle);
  let pattern=isIncoming?null:next.patterns.find(p=>p.present&&p.path===plan.sourcePath);
  if(!isIncoming&&!pattern)throw new Error(`이동할 도안의 메타데이터를 찾지 못했습니다: ${plan.sourcePath}`);
  if(!pattern){
    const review=downloadFiles.find(file=>file.name===plan.sourceName);inferReviewCategories(review);
    pattern={id:review.patternId||crypto.randomUUID(),categoryIds:[...review.categoryIds],categorySource:review.categorySource,representativePage:1};next.patterns.push(pattern);
  }
  if(!isIncoming){
    const source=await (await plan.sourceDirectory.getFileHandle(plan.sourceName)).getFile();
    if(source.size!==pattern.size||source.lastModified!==pattern.lastModified)throw new Error('라이브러리 파일이 변경되었습니다. 패턴 목록을 새로고침하세요.');
  }
  Object.assign(pattern,{path:`${plan.targetFolderName}/${plan.targetName}`,size:copiedFile.size,lastModified:copiedFile.lastModified,present:true});
  if(plan.targetFolderName!=='!zz_Singles')pattern.designerName=plan.targetFolderName;
  else if(isIncoming)pattern.designerName=downloadFiles.find(file=>file.name===plan.sourceName).destinationName.trim();
  if(sha256)pattern.sha256=sha256;
  await persistCatalog(next);
}
function initializeCatalogControls(){
  const cancel=document.createElement('button');cancel.id='cancelCategoryEditsButton';cancel.type='button';cancel.className='secondary-button';cancel.dataset.catalogControl='';cancel.textContent='카테고리 편집 취소';
  document.getElementById('saveCategoriesButton').after(cancel);
  cancel.onclick=()=>{categoryEditorDirty=false;document.getElementById('newCategoryName').value='';renderCategoryManager();renderCatalogControls();setCatalogStatus('카테고리 편집을 취소했습니다. 저장된 분류를 유지합니다.');};
  document.getElementById('refreshLibraryButton').onclick=()=>catalogAction(async()=>{await loadLibraryCatalog();});
  document.getElementById('saveCategoriesButton').onclick=()=>catalogAction(async()=>{const next=structuredClone(libraryCatalog);next.categories=categoryManagerDraft();await persistCatalog(next);categoryEditorDirty=false;});
  document.getElementById('addCategoryButton').onclick=()=>catalogAction(async()=>{
    const input=document.getElementById('newCategoryName'),name=input.value.trim();if(!name)throw new Error('새 카테고리 이름을 입력하세요.');
    const next=structuredClone(libraryCatalog);next.categories=categoryManagerDraft();next.categories.push({id:crypto.randomUUID(),name,keywords:[]});await persistCatalog(next);categoryEditorDirty=false;input.value='';
  });
  document.getElementById('libraryPreviousButton').onclick=()=>{libraryPage--;renderLibraryPatterns();};
  document.getElementById('libraryNextButton').onclick=()=>{libraryPage++;renderLibraryPatterns();};
  document.getElementById('reanalyzeLibraryButton').onclick=()=>catalogAction(async()=>{
    if(categoryEditorDirty)throw new Error('카테고리 키워드 편집 내용을 먼저 저장하세요.');
    const next=structuredClone(libraryCatalog);
    for(const pattern of next.patterns.filter(p=>p.present&&p.categorySource!=='manual')){pattern.categoryIds=CatalogModel.infer(pattern.path.split('/').at(-1),next.categories);pattern.categorySource='filename';delete pattern.analysis;}
    await persistCatalog(next);
  });
  renderCatalogUI();
}
