let galleryQuery='',galleryCategory='',galleryDesigner='',gallerySort='name',galleryLayout='grid';
let galleryAttributes=[];
let gallerySearchPending=false;
const libraryPageDrafts=new Map();
let gallerySelectionCache;
try{galleryLayout=localStorage.getItem('pdfOrganizerLibraryLayout')==='list'?'list':'grid';}catch{}

const GalleryPreviews=(()=>{
  let generation=0,queue=[],busy=false,controller,observer;
  const urls=new Set(),stats={rendered:0,hits:0,failed:0,queued:0};
  function updateStatus(){
    const status=document.getElementById('previewStatus');
    if(status.dataset.override)return;
    status.textContent=stats.failed?`Could not load ${stats.failed} previews. Open the PDF or retry from its card.`:
      busy?'Loading previews for visible PDFs...':'Previews load for visible PDFs first.';
    if(ThumbnailStore.unavailable)status.textContent+=' The cache could not be saved. Previews may be regenerated on the next visit.';
  }
  function reset(){
    generation++;queue=[];stats.queued=0;stats.failed=0;observer?.disconnect();controller?.abort();
    delete document.getElementById('previewStatus').dataset.override;
    for(const url of urls)URL.revokeObjectURL(url);urls.clear();
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);enqueue(entry.target._previewJob);}
    },{rootMargin:'100px'});
  }
  async function obtain(file,pattern,pageNumber,signal){
    const key=GalleryModel.cacheKey(libraryCatalog.libraryId,pattern,pageNumber);
    let cached;
    try{cached=await ThumbnailStore.get(key);}catch{}
    if(signal?.aborted)throw new DOMException('Request canceled','AbortError');
    if(cached&&cached.blob instanceof Blob&&cached.blob.size>0&&Number.isSafeInteger(cached.pages)&&cached.pages>=pageNumber&&cached.page===pageNumber){stats.hits++;return cached;}
    const result=await PdfPreview.render(file.handle,pattern,pageNumber,signal);
    if(signal?.aborted)throw new DOMException('Request canceled','AbortError');
    stats.rendered++;
    try{await ThumbnailStore.put(key,result);}catch{}
    return result;
  }
  function enqueue(job){
    if(!job||job.token!==generation||!job.image.isConnected)return;
    if(!queue.includes(job)){queue.push(job);stats.queued=queue.length;}
    resume();
  }
  async function resume(){
    if(busy||activeView!=='library'||operationBusy||!libraryCatalog)return;
    const job=queue.shift();stats.queued=queue.length;
    if(!job){updateStatus();return;}
    if(job.token!==generation||!job.image.isConnected){resume();return;}
    const bounds=job.card.getBoundingClientRect();
    if(bounds.bottom < -100 || bounds.top > innerHeight+100){observer.observe(job.card);resume();return;}
    busy=true;controller=new AbortController();updateStatus();
    try{
      const result=await obtain(job.file,job.pattern,GalleryModel.representative(job.pattern),controller.signal);
      if(job.token!==generation||!job.image.isConnected||controller.signal.aborted)return;
      const url=URL.createObjectURL(result.blob);urls.add(url);job.image.src=url;job.image.hidden=false;
      job.placeholder.hidden=true;job.card.dataset.preview='ready';job.card.dataset.pages=String(result.pages);
      job.caption.textContent=`Cover page ${result.page} / ${result.pages} pages`;
      job.card.querySelector('.representative-page-input')?.setAttribute('max',String(result.pages));
    }catch(error){
      if(job.token!==generation||!job.image.isConnected||controller.signal.aborted)return;
      stats.failed++;job.card.dataset.preview='error';
      job.placeholder.textContent=error.name==='PasswordException'?'This PDF requires a password. Open the original file to check it.':error.message.includes('changed')||error.numPages?error.message:'Could not create a preview. Open the PDF to check it.';
      if(error.numPages){job.card.dataset.pages=String(error.numPages);job.card.querySelector('.representative-page-input')?.setAttribute('max',String(error.numPages));}
      const retry=document.createElement('button');retry.type='button';retry.className='secondary-button';retry.textContent='Retry preview';
      retry.onclick=event=>{event.preventDefault();event.stopPropagation();stats.failed=Math.max(0,stats.failed-1);retry.remove();job.placeholder.textContent='Loading preview...';job.card.dataset.preview='pending';enqueue(job);};
      job.placeholder.append(retry);
    }finally{busy=false;updateStatus();resume();}
  }
  function observe(job){job.token=generation;job.card._previewJob=job;observer.observe(job.card);}
  function suspend(){queue=[];stats.queued=0;controller?.abort();observer?.disconnect();}
  return {reset,observe,resume,suspend,obtain,get stats(){return {...stats,busy,urls:urls.size};}};
})();

function galleryState(){return {query:galleryQuery,category:galleryCategory,attributes:[...galleryAttributes],designerName:galleryDesigner,sort:gallerySort};}
function selectedGalleryPatterns(){
  const state=JSON.stringify(galleryState());
  if(!gallerySelectionCache||gallerySelectionCache.catalog!==libraryCatalog||gallerySelectionCache.state!==state)gallerySelectionCache={catalog:libraryCatalog,state,patterns:GalleryModel.select(libraryCatalog,galleryState())};
  return gallerySelectionCache.patterns;
}
function populateGalleryFilters(){
  const host=document.getElementById('libraryAttributeFilter');
  if(!host.children.length)host.append(attributePicker(galleryAttributes,ids=>{
    galleryAttributes=ids;gallerySearchPending=false;libraryPage=0;
    clearLibrarySelection(librarySelection.size?'Selection cleared because attributes changed.':'');renderLibraryPatterns();
  },'Attributes (match all)'));
  host.querySelectorAll('input').forEach(input=>input.checked=galleryAttributes.includes(input.value));
  const category=document.getElementById('libraryCategoryFilter'),designer=document.getElementById('libraryDesignerFilter');
  category.replaceChildren(new Option('All categories',''));
  for(const item of availableCategories())category.add(new Option(item.name,item.id));
  if(!availableCategories().some(c=>c.id===galleryCategory))galleryCategory='';category.value=galleryCategory;
  designer.replaceChildren(new Option('All designers',''));
  const designers=[...new Set((libraryCatalog?.patterns||[]).filter(p=>p.present).map(GalleryModel.designer).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  for(const name of designers)designer.add(new Option(name,name));
  if(galleryDesigner&&!designers.includes(galleryDesigner))galleryDesigner='';designer.value=galleryDesigner;
}
function renderGalleryControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog;
  for(const id of ['librarySearch','libraryCategoryFilter','libraryDesignerFilter','librarySort','galleryGridButton','galleryListButton','clearGalleryFiltersButton','clearThumbnailCacheButton'])document.getElementById(id).disabled=disabled;
  document.querySelectorAll('#libraryAttributeFilter input').forEach(input=>input.disabled=disabled);
  document.querySelectorAll('[data-gallery-action]').forEach(control=>control.disabled=disabled||Boolean(catalogError));
  const state=GalleryModel.page(selectedGalleryPatterns(),libraryPage);
  for(const id of ['libraryPreviousButton','galleryPreviousBottom'])document.getElementById(id).disabled=disabled||state.current===0;
  for(const id of ['libraryNextButton','galleryNextBottom'])document.getElementById(id).disabled=disabled||state.current+1>=state.pages;
  document.getElementById('galleryGridButton').setAttribute('aria-pressed',String(galleryLayout==='grid'));
  document.getElementById('galleryListButton').setAttribute('aria-pressed',String(galleryLayout==='list'));
  renderLibraryBulkControls();
}
function renderGallery(){
  reconcileLibrarySelection();
  populateGalleryFilters();GalleryPreviews.reset();
  const list=document.getElementById('libraryPatternList');list.replaceChildren();list.className=`pattern-gallery ${galleryLayout==='list'?'list-view':''}`;
  list.dataset.query=galleryQuery;
  const selection=GalleryModel.page(selectedGalleryPatterns(),libraryPage);libraryPage=selection.current;
  const total=libraryCatalog?.patterns.filter(p=>p.present).length||0;
  const summary=`${selection.total} results / ${total} total · Page ${selection.current+1} / ${selection.pages}`;
  document.getElementById('libraryPageSummary').textContent=summary;document.getElementById('galleryBottomSummary').textContent=summary;
  if(!selection.items.length){const empty=document.createElement('p');empty.className='empty gallery-empty';empty.textContent=libraryCatalog?(total?'No PDFs match these filters. Clear the filters and try again.':'No PDFs in this folder.'):'Connect a pattern folder to browse the PDF gallery.';list.append(empty);}
  const files=new Map(indexedLibraryFiles.map(file=>[file.path,file]));
  for(const pattern of selection.items){
    const file=files.get(pattern.path);if(!file)continue;
    const card=document.createElement('article');card.className='library-pattern';card.dataset.patternId=pattern.id;card.dataset.preview='pending';
    const header=document.createElement('div'),visual=document.createElement('div');header.className='pattern-card-header';visual.className='pattern-thumbnail';
    const image=document.createElement('img');image.hidden=true;image.alt=`${file.name}, cover page ${GalleryModel.representative(pattern)}`;image.decoding='async';
    const placeholder=document.createElement('div');placeholder.className='thumbnail-placeholder';placeholder.textContent='Preview pending';visual.append(image,placeholder);
    const info=document.createElement('div');info.className='pattern-info';
    const title=document.createElement('button');title.type='button';title.className='pattern-link pattern-title';title.dataset.galleryAction='';title.textContent=file.name.replace(/\.pdf$/i,'');title.title='Open PDF';title.onclick=()=>openReviewPdf(file);
    const designerName=GalleryModel.designer(pattern);
    const designer=document.createElement(designerName?'button':'span');designer.className='pattern-designer';designer.textContent=designerName||'Root / special folder';
    if(designerName){designer.type='button';designer.classList.add('pattern-link');designer.dataset.galleryAction='';designer.title='Show patterns by this designer';designer.onclick=()=>filterGalleryDesigner(designerName);}
    const labels=document.createElement('span');labels.className='category-labels';labels.textContent=pattern.categoryIds.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(' · ');
    const attributes=document.createElement('span');attributes.className='attribute-labels';attributes.textContent=CatalogModel.attributeIds(pattern.attributeIds).join(' · ');
    const caption=document.createElement('span');caption.className='pattern-page-caption';caption.textContent=`Cover page ${GalleryModel.representative(pattern)}`;
    card._pageCaption=caption;
    const edit=document.createElement('button');edit.type='button';edit.className='pattern-edit-button';edit.dataset.galleryAction='';edit.textContent='Edit';edit.setAttribute('aria-label','Edit');edit.setAttribute('aria-expanded','false');edit.setAttribute('aria-controls',`gallery-editor-${pattern.id}`);edit.title='Edit categories, attributes and cover page';
    edit.onclick=()=>setGalleryEditing(card,pattern,file,!card.classList.contains('is-editing'));
    visual.append(edit);info.append(title,designer,labels,attributes);header.append(visual,info);card.append(header);
    addLibrarySelectionControl(card,pattern);
    list.append(card);if(libraryCategoryDrafts.has(pattern.id)||libraryAttributeDrafts.has(pattern.id)||libraryPageDrafts.has(pattern.id))setGalleryEditing(card,pattern,file,true);
    GalleryPreviews.observe({card,image,placeholder,caption,pattern,file});
  }
  renderGalleryControls();
}
function filterGalleryDesigner(name){
  if(operationBusy||draftLockedElsewhere||!libraryCatalog||catalogError)return;
  galleryDesigner=name;gallerySearchPending=false;libraryPage=0;
  clearLibrarySelection(librarySelection.size?'Selection cleared because the designer changed.':'');
  renderLibraryPatterns();
}
function setGalleryEditing(card,pattern,file,open){
  if(open&&!card.querySelector('.gallery-editor'))mountGalleryEditor(card,pattern,file);
  card.classList.toggle('is-editing',open);
  const editor=card.querySelector('.gallery-editor');if(editor)editor.hidden=!open;
  const button=card.querySelector('.pattern-edit-button');button.textContent=open?'Close':'Edit';button.setAttribute('aria-label',open?'Close editor':'Edit');button.setAttribute('aria-expanded',String(open));
}
function mountGalleryEditor(card,pattern,file){
  const editor=document.createElement('div');editor.className='gallery-editor';editor.id=`gallery-editor-${pattern.id}`;
  const path=document.createElement('p');path.className='pattern-path';path.textContent=pattern.path;editor.append(path,card._pageCaption);
  if(pattern.analysis){
    const result=document.createElement('p');result.className='note';
    const labels={done:'Analysis complete','no-text':'No text. Classify scanned PDFs manually.',uncertain:'No clear category or conflict with filename classification. Existing categories preserved.',error:pattern.analysis.error};
    result.textContent=`PDF text · ${labels[pattern.analysis.status]} · Pages checked: ${pattern.analysis.pages}${pattern.categorySource==='manual'?' · Manual classification preserved':''}`;
    if(pattern.analysis.matches.length)result.textContent+=` · Categories found in title: ${pattern.analysis.matches.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(', ')}`;
    editor.append(result);
  }
  let ids=[...(libraryCategoryDrafts.get(pattern.id)||pattern.categoryIds)];
  const notice=document.createElement('p');notice.className='note';notice.textContent=libraryCategoryDrafts.has(pattern.id)?'Editing. Select Save categories when ready.':'Select categories, then save.';
  editor.append(categoryPicker(ids,value=>{ids=value;libraryCategoryDrafts.set(pattern.id,[...value]);notice.textContent='Editing. Select Save categories when ready.';},`${pattern.path} Category`),notice);
  let attributes=[...(libraryAttributeDrafts.get(pattern.id)||CatalogModel.attributeIds(pattern.attributeIds))];
  const attributeNotice=document.createElement('p');attributeNotice.className='note';
  attributeNotice.textContent=libraryAttributeDrafts.has(pattern.id)?'Editing attributes. Select Save attributes when ready.':'Attributes are optional. Select any that apply.';
  editor.append(attributePicker(attributes,value=>{attributes=value;libraryAttributeDrafts.set(pattern.id,[...value]);attributeNotice.textContent='Editing attributes. Select Save attributes when ready.';}),attributeNotice);
  const actions=document.createElement('div');actions.className='gallery-editor-actions';
  const button=(text,callback)=>{const node=document.createElement('button');node.type='button';node.className='secondary-button';node.textContent=text;node.onclick=callback;actions.append(node);return node;};
  button('Save categories',()=>catalogAction(async()=>{const next=structuredClone(libraryCatalog);const target=next.patterns.find(p=>p.id===pattern.id);target.categoryIds=ids;target.categorySource='manual';await persistCatalog(next);libraryCategoryDrafts.delete(pattern.id);})).dataset.catalogControl='';
  button('Save attributes',()=>catalogAction(async()=>{const next=CatalogModel.replaceAttributes(libraryCatalog,[pattern.id],attributes);await persistCatalog(next);libraryAttributeDrafts.delete(pattern.id);})).dataset.catalogControl='';
  button('Cancel changes',()=>{libraryCategoryDrafts.delete(pattern.id);libraryAttributeDrafts.delete(pattern.id);libraryPageDrafts.delete(pattern.id);renderLibraryPatterns();});
  button('Open PDF',()=>openReviewPdf(file));editor.append(actions);
  const pageTools=document.createElement('div');pageTools.className='representative-page-tools';
  const label=document.createElement('label');label.textContent='Cover page';label.htmlFor=`representative-${pattern.id}`;
  const input=document.createElement('input');input.id=label.htmlFor;input.type='number';input.min='1';input.step='1';input.value=libraryPageDrafts.get(pattern.id)??GalleryModel.representative(pattern);input.className='text-input representative-page-input';if(card.dataset.pages)input.max=card.dataset.pages;
  input.oninput=()=>{libraryPageDrafts.set(pattern.id,input.value);};
  const savePage=document.createElement('button');savePage.type='button';savePage.className='secondary-button';savePage.textContent='Save cover page';savePage.dataset.catalogControl='';
  savePage.onclick=()=>catalogAction(async()=>{
    const number=Number(input.value);if(!Number.isSafeInteger(number)||number<1)throw new Error('Enter a whole number of 1 or greater for the cover page.');
    await GalleryPreviews.obtain(file,pattern,number);
    const next=structuredClone(libraryCatalog);next.patterns.find(p=>p.id===pattern.id).representativePage=number;await persistCatalog(next);libraryPageDrafts.delete(pattern.id);
  });
  pageTools.append(label,input,savePage);editor.append(pageTools);card.append(editor);
  renderCatalogControls();if(operationBusy)setOperationBusy(true);
}
function initializeGalleryControls(){
  initializeLibraryBulkControls();
  let searchTimer;
  const changed=()=>{gallerySearchPending=false;libraryPage=0;renderLibraryPatterns();};
  const filtersChanged=()=>{clearLibrarySelection(librarySelection.size?'Selection cleared because search or filters changed.':'');renderLibraryBulkControls();};
  document.getElementById('librarySearch').oninput=event=>{galleryQuery=event.target.value;gallerySearchPending=true;filtersChanged();clearTimeout(searchTimer);searchTimer=setTimeout(changed,150);};
  document.getElementById('libraryCategoryFilter').onchange=event=>{galleryCategory=event.target.value;filtersChanged();changed();};
  document.getElementById('libraryDesignerFilter').onchange=event=>{galleryDesigner=event.target.value;filtersChanged();changed();};
  document.getElementById('librarySort').onchange=event=>{gallerySort=event.target.value;changed();};
  for(const mode of ['grid','list'])document.getElementById(mode==='grid'?'galleryGridButton':'galleryListButton').onclick=()=>{galleryLayout=mode;try{localStorage.setItem('pdfOrganizerLibraryLayout',mode);}catch{}renderLibraryPatterns();};
  document.getElementById('clearGalleryFiltersButton').onclick=()=>{clearTimeout(searchTimer);galleryQuery='';galleryCategory='';galleryAttributes=[];galleryDesigner='';document.getElementById('librarySearch').value='';filtersChanged();changed();};
  document.getElementById('clearThumbnailCacheButton').onclick=async()=>{
    if(operationBusy)return;GalleryPreviews.suspend();setOperationBusy(true);
    let failed=false;
    try{await ThumbnailStore.clear();}catch{failed=true;}
    finally{setOperationBusy(false);renderLibraryPatterns();if(failed){const status=document.getElementById('previewStatus');status.dataset.override='true';status.textContent='Could not clear the cache. Try again.';}}
  };
  document.getElementById('galleryPreviousBottom').onclick=()=>{libraryPage--;renderLibraryPatterns();};
  document.getElementById('galleryNextBottom').onclick=()=>{libraryPage++;renderLibraryPatterns();};
}
