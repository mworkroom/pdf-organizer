const CATALOG_FILE_NAME='!pdf-organizer-library.json';
const CATALOG_BACKUP_NAME='!pdf-organizer-library.backup.json';
let libraryCatalog=null, catalogRoot=null, catalogDiskText=null, catalogError='';
let indexedLibraryFiles=[], libraryPage=0;
let categoryEditorDirty=false;
const libraryCategoryDrafts=new Map();
const libraryAttributeDrafts=new Map();
const defaultCategories=CatalogModel.create().categories;

function availableCategories(){return libraryCatalog?.categories || defaultCategories;}
function hasPendingLibraryEdits(){return Boolean(categoryEditorDirty||libraryCategoryDrafts.size||libraryAttributeDrafts.size||libraryPageDrafts.size);}
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
  if(!libraryCatalog||catalogError||!catalogRoot||!await catalogRoot.isSameEntry(libraryDirectoryHandle))throw new Error(catalogError||'Load the pattern folder metadata first.');
  CatalogModel.validate(next);
  // Compare the exact disk snapshot, so another app/tab cannot silently lose changes.
  const current=await readCatalogText(catalogRoot);
  if(current!==catalogDiskText)throw new Error('Metadata changed elsewhere. Refresh the library and try again.');
  next.revision=libraryCatalog.revision+1;next.updatedAt=new Date().toISOString();
  const text=JSON.stringify(next,null,2)+'\n';
  if(current!==null)await writeCatalogText(catalogRoot,CATALOG_BACKUP_NAME,current);
  await writeCatalogText(catalogRoot,CATALOG_FILE_NAME,text);
  libraryCatalog=next;catalogDiskText=text;
  setCatalogStatus(`Metadata saved · PDFs: ${next.patterns.filter(p=>p.present).length} · Categories: ${next.categories.length}`);
}
async function loadLibraryCatalog(){
  const root=libraryDirectoryHandle;
  if(hasPendingLibraryEdits())throw new Error('Save or cancel category, attribute and cover page edits before reconnecting the library.');
  if(typeof resetMaintenance==='function')resetMaintenance();
  libraryCatalog=null;indexedLibraryFiles=[];catalogRoot=root;catalogError='';
  setCatalogStatus('Checking the pattern library and metadata...');
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
    setCatalogStatus(`Metadata saved · PDFs: ${files.length} · Categories: ${libraryCatalog.categories.length}`);
  }catch(error){
    libraryCatalog=null;catalogError=error.message;
    setCatalogStatus(`Could not load metadata: ${error.message}. Check the original JSON and backup files.`);
  }
  libraryPage=0;renderCatalogUI();
}
function inferReviewCategories(file){
  file.patternId ||= crypto.randomUUID();
  file.categoryIds=CatalogModel.categoryIds(file.categoryIds,availableCategories());
  file.attributeIds=CatalogModel.attributeIds(file.attributeIds);
  if(file.categorySource!=='manual'){
    file.categoryIds=CatalogModel.infer(file.patternFileName||file.name,availableCategories());file.categorySource='filename';
  }
}
function categoryPicker(ids,onChange,label='Category',allowEmpty=false){
  const field=document.createElement('fieldset');field.className='category-picker';
  const legend=document.createElement('legend');legend.textContent=label;field.append(legend);
  let selected=allowEmpty&&!ids.length?[]:CatalogModel.categoryIds(ids,availableCategories());
  for(const category of availableCategories()){
    const item=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');
    input.type='checkbox';input.value=category.id;input.checked=selected.includes(category.id);input.disabled=draftLockedElsewhere;
    name.textContent=category.name;item.append(input,name);field.append(item);
    input.addEventListener('change',()=>{
      if(category.id==='unknown'&&input.checked)selected=['unknown'];
      else {
        const next=input.checked?[...selected,category.id]:selected.filter(id=>id!==category.id);
        selected=allowEmpty&&!next.length?[]:CatalogModel.categoryIds(next,availableCategories());
      }
      field.querySelectorAll('input').forEach(box=>box.checked=selected.includes(box.value));onChange([...selected]);
    });
  }
  return field;
}
function attributePicker(ids,onChange,label='Attributes'){
  const field=document.createElement('fieldset');field.className='category-picker attribute-picker';
  const legend=document.createElement('legend');legend.textContent=label;field.append(legend);
  const selected=CatalogModel.attributeIds(ids);
  for(const id of CatalogModel.attributes){
    const item=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');
    input.type='checkbox';input.value=id;input.checked=selected.includes(id);input.disabled=draftLockedElsewhere;
    name.textContent=id;item.append(input,name);field.append(item);
    input.onchange=()=>{
      onChange(CatalogModel.attributeIds([...field.querySelectorAll('input:checked')].map(control=>control.value)));
    };
  }
  return field;
}
function renderReviewCategories(file){
  inferReviewCategories(file);
  const section=document.createElement('div');section.className='review-categories';
  section.append(categoryPicker(file.categoryIds,ids=>{file.categoryIds=ids;file.categorySource='manual';scheduleDraftSave();section.querySelector('.note').textContent='Manual classification. Preserved during reanalysis.';},'Categories (select multiple)'));
  const hint=document.createElement('p');hint.className='note';hint.textContent=file.categorySource==='manual'?'Manual classification. Preserved during reanalysis.':'Automatic filename classification. Unknown when uncertain.';
  const reanalyze=document.createElement('button');reanalyze.type='button';reanalyze.className='secondary-button';reanalyze.textContent='Reanalyze filename';
  reanalyze.addEventListener('click',()=>{
    if(file.categorySource==='manual'){hint.textContent='Manual classification preserved.';return;}
    inferReviewCategories(file);file.rowElement?.querySelector('.review-categories')?.replaceWith(renderReviewCategories(file));scheduleDraftSave();
  });
  section.append(hint,reanalyze);
  section.append(attributePicker(file.attributeIds,ids=>{file.attributeIds=ids;scheduleDraftSave();}));
  if(file.excluded)section.querySelectorAll('input,button').forEach(control=>control.disabled=true);
  return section;
}
async function catalogAction(action){
  if(operationBusy||draftLockedElsewhere)return;
  setOperationBusy(true);setCatalogStatus('Saving metadata...');
  try{await action();scheduleDraftSave();await saveReviewDraft();}
  catch(error){setCatalogStatus(`Metadata operation failed: ${error.message}`);}
  finally{setOperationBusy(false);renderCatalogUI();renderSortingRows();}
}
function renderCatalogControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  document.querySelectorAll('[data-catalog-control]').forEach(control=>control.disabled=disabled);
  document.getElementById('refreshLibraryButton').disabled=operationBusy||draftLockedElsewhere||!libraryDirectoryHandle;
  renderGalleryControls();
  if(typeof renderMaintenanceControls==='function')renderMaintenanceControls();
}
function renderCatalogUI(){
  renderCategoryManager();renderLibraryPatterns();
  if(typeof renderMaintenance==='function')renderMaintenance();
  renderCatalogControls();
  if(operationBusy)setOperationBusy(true);
}
function categoryManagerDraft(){
  return [...document.querySelectorAll('.category-editor')].map(row=>({id:row.dataset.id,name:row.querySelector('.category-name').value.trim(),keywords:row.querySelector('.category-keywords').value.split(',').map(s=>s.trim()).filter(Boolean)}));
}
function renderCategoryManager(){
  if(categoryEditorDirty)return;
  const list=document.getElementById('categoryManagerList');list.replaceChildren();
  if(!libraryCatalog){list.innerHTML='<p class="empty">Connect a pattern folder to manage categories.</p>';return;}
  for(const [index,category] of libraryCatalog.categories.entries()){
    const row=document.createElement('div');row.className='category-editor';row.dataset.id=category.id;
    const name=document.createElement('input');name.className='text-input category-name';name.value=category.name;name.setAttribute('aria-label',`${category.name} Name`);
    const keywords=document.createElement('input');keywords.className='text-input category-keywords';keywords.value=category.keywords.join(', ');keywords.setAttribute('aria-label',`${category.name} Inference keywords`);keywords.placeholder='Keywords, separated by commas';
    name.oninput=keywords.oninput=()=>{categoryEditorDirty=true;setCatalogStatus('Editing categories. Select Save category changes when ready.');};
    // Other/Unknown are semantic fallbacks: editable labels, no inference keywords.
    keywords.readOnly=['other','unknown'].includes(category.id);
    const tools=document.createElement('div');tools.className='category-row-tools';
    for(const [label,offset] of [['Move up',-1],['Move down',1]]){
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=label;button.setAttribute('aria-label',`${category.name} ${label}`);
      button.disabled=index+offset<0||index+offset>=libraryCatalog.categories.length;
      button.onclick=()=>{const rows=[...list.children];const target=rows[index+offset];if(target){if(offset<0)target.before(row);else target.after(row);categoryEditorDirty=true;refreshCategoryOrderButtons();}};
      tools.append(button);
    }
    const replacement=document.createElement('select');replacement.className='text-input';replacement.setAttribute('aria-label',`${category.name} Replacement category on deletion`);
    for(const other of libraryCatalog.categories.filter(c=>c.id!==category.id)){const option=document.createElement('option');option.value=other.id;option.textContent=other.name;replacement.append(option);}replacement.value='unknown';
    const remove=document.createElement('button');remove.type='button';remove.className='secondary-button';remove.textContent='Delete';remove.setAttribute('aria-label',`${category.name} Delete`);remove.disabled=['other','unknown'].includes(category.id);
    remove.onclick=()=>{
      if(operationBusy)return;
      const replacementId=replacement.value;
      if(!window.confirm(`Delete ${category.name} and replace its assignments with ${replacement.selectedOptions[0].textContent}? Other pending category edits will also be saved.`))return;
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
  if(!libraryCatalog||catalogError)throw new Error(catalogError||'Metadata is unavailable.');
  const next=structuredClone(libraryCatalog);
  const isIncoming=await plan.sourceDirectory.isSameEntry(downloadDirectoryHandle);
  let pattern=isIncoming?null:next.patterns.find(p=>p.present&&p.path===plan.sourcePath);
  if(!isIncoming&&!pattern)throw new Error(`Could not find metadata for the pattern to move: ${plan.sourcePath}`);
  if(!pattern){
    const review=downloadFiles.find(file=>file.name===plan.sourceName);inferReviewCategories(review);
    pattern={id:review.patternId||crypto.randomUUID(),categoryIds:[...review.categoryIds],categorySource:review.categorySource,attributeIds:[...review.attributeIds],representativePage:1};next.patterns.push(pattern);
  }
  if(!isIncoming){
    const source=await (await plan.sourceDirectory.getFileHandle(plan.sourceName)).getFile();
    if(source.size!==pattern.size||source.lastModified!==pattern.lastModified)throw new Error('The library file has changed. Refresh the library.');
  }
  Object.assign(pattern,{path:`${plan.targetFolderName}/${plan.targetName}`,size:copiedFile.size,lastModified:copiedFile.lastModified,present:true});
  if(plan.targetFolderName!=='!zz_Singles')pattern.designerName=plan.targetFolderName;
  else if(isIncoming)pattern.designerName=downloadFiles.find(file=>file.name===plan.sourceName).destinationName.trim();
  if(sha256)pattern.sha256=sha256;
  await persistCatalog(next);
}
function initializeCatalogControls(){
  const cancel=document.createElement('button');cancel.id='cancelCategoryEditsButton';cancel.type='button';cancel.className='secondary-button';cancel.dataset.catalogControl='';cancel.textContent='Cancel category edits';
  document.getElementById('saveCategoriesButton').after(cancel);
  cancel.onclick=()=>{categoryEditorDirty=false;document.getElementById('newCategoryName').value='';renderCategoryManager();renderCatalogControls();setCatalogStatus('Category edits canceled. Saved classifications are preserved.');};
  document.getElementById('refreshLibraryButton').onclick=()=>catalogAction(async()=>{await loadLibraryCatalog();});
  document.getElementById('saveCategoriesButton').onclick=()=>catalogAction(async()=>{const next=structuredClone(libraryCatalog);next.categories=categoryManagerDraft();await persistCatalog(next);categoryEditorDirty=false;});
  document.getElementById('addCategoryButton').onclick=()=>catalogAction(async()=>{
    const input=document.getElementById('newCategoryName'),name=input.value.trim();if(!name)throw new Error('Enter a new category name.');
    const next=structuredClone(libraryCatalog);next.categories=categoryManagerDraft();next.categories.push({id:crypto.randomUUID(),name,keywords:[]});await persistCatalog(next);categoryEditorDirty=false;input.value='';
  });
  document.getElementById('libraryPreviousButton').onclick=()=>{libraryPage--;renderLibraryPatterns();};
  document.getElementById('libraryNextButton').onclick=()=>{libraryPage++;renderLibraryPatterns();};
  document.getElementById('reanalyzeLibraryButton').onclick=()=>catalogAction(async()=>{
    if(categoryEditorDirty)throw new Error('Save category keyword edits first.');
    const next=structuredClone(libraryCatalog);
    for(const pattern of next.patterns.filter(p=>p.present&&p.categorySource!=='manual')){pattern.categoryIds=CatalogModel.infer(pattern.path.split('/').at(-1),next.categories);pattern.categorySource='filename';delete pattern.analysis;}
    await persistCatalog(next);
  });
  renderCatalogUI();
}
