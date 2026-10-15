let galleryQuery='',galleryCategory='',galleryDesigner='',gallerySort='name',galleryLayout='grid';
const libraryPageDrafts=new Map();
let gallerySelectionCache;
try{galleryLayout=localStorage.getItem('pdfOrganizerLibraryLayout')==='list'?'list':'grid';}catch{}

const GalleryPreviews=(()=>{
  let generation=0,queue=[],busy=false,controller,observer;
  const urls=new Set(),stats={rendered:0,hits:0,failed:0,queued:0};
  function updateStatus(){
    const status=document.getElementById('previewStatus');
    if(status.dataset.override)return;
    status.textContent=stats.failed?`미리보기 ${stats.failed}개를 준비하지 못했습니다. 해당 카드에서 PDF를 열거나 다시 시도하세요.`:
      busy?'화면에 보이는 PDF 미리보기를 준비하는 중...':'미리보기는 화면에 보이는 PDF부터 준비합니다.';
    if(ThumbnailStore.unavailable)status.textContent+=' 캐시를 저장하지 못해 다음 방문에 다시 생성할 수 있습니다.';
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
    if(signal?.aborted)throw new DOMException('요청 취소','AbortError');
    if(cached&&cached.blob instanceof Blob&&cached.blob.size>0&&Number.isSafeInteger(cached.pages)&&cached.pages>=pageNumber&&cached.page===pageNumber){stats.hits++;return cached;}
    const result=await PdfPreview.render(file.handle,pattern,pageNumber,signal);
    if(signal?.aborted)throw new DOMException('요청 취소','AbortError');
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
      job.caption.textContent=`대표 ${result.page} / 총 ${result.pages}페이지`;
      job.card.querySelector('.representative-page-input')?.setAttribute('max',String(result.pages));
    }catch(error){
      if(job.token!==generation||!job.image.isConnected||controller.signal.aborted)return;
      stats.failed++;job.card.dataset.preview='error';
      job.placeholder.textContent=error.name==='PasswordException'?'암호가 필요한 PDF입니다. 원본을 열어 확인하세요.':error.message.includes('변경')||error.numPages?error.message:'미리보기를 만들지 못했습니다. PDF를 열어 확인하세요.';
      if(error.numPages){job.card.dataset.pages=String(error.numPages);job.card.querySelector('.representative-page-input')?.setAttribute('max',String(error.numPages));}
      const retry=document.createElement('button');retry.type='button';retry.className='secondary-button';retry.textContent='미리보기 다시 시도';
      retry.onclick=event=>{event.preventDefault();event.stopPropagation();stats.failed=Math.max(0,stats.failed-1);retry.remove();job.placeholder.textContent='미리보기 준비 중...';job.card.dataset.preview='pending';enqueue(job);};
      job.placeholder.append(retry);
    }finally{busy=false;updateStatus();resume();}
  }
  function observe(job){job.token=generation;job.card._previewJob=job;observer.observe(job.card);}
  function suspend(){queue=[];stats.queued=0;controller?.abort();observer?.disconnect();}
  return {reset,observe,resume,suspend,obtain,get stats(){return {...stats,busy,urls:urls.size};}};
})();

function galleryState(){return {query:galleryQuery,category:galleryCategory,designerName:galleryDesigner,sort:gallerySort};}
function selectedGalleryPatterns(){
  const state=JSON.stringify(galleryState());
  if(!gallerySelectionCache||gallerySelectionCache.catalog!==libraryCatalog||gallerySelectionCache.state!==state)gallerySelectionCache={catalog:libraryCatalog,state,patterns:GalleryModel.select(libraryCatalog,galleryState())};
  return gallerySelectionCache.patterns;
}
function populateGalleryFilters(){
  const category=document.getElementById('libraryCategoryFilter'),designer=document.getElementById('libraryDesignerFilter');
  category.replaceChildren(new Option('모든 카테고리',''));
  for(const item of availableCategories())category.add(new Option(item.name,item.id));
  if(!availableCategories().some(c=>c.id===galleryCategory))galleryCategory='';category.value=galleryCategory;
  designer.replaceChildren(new Option('모든 디자이너',''));
  const designers=[...new Set((libraryCatalog?.patterns||[]).filter(p=>p.present).map(GalleryModel.designer).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  for(const name of designers)designer.add(new Option(name,name));
  if(galleryDesigner&&!designers.includes(galleryDesigner))galleryDesigner='';designer.value=galleryDesigner;
}
function renderGalleryControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog;
  for(const id of ['librarySearch','libraryCategoryFilter','libraryDesignerFilter','librarySort','galleryGridButton','galleryListButton','clearGalleryFiltersButton','clearThumbnailCacheButton'])document.getElementById(id).disabled=disabled;
  const state=GalleryModel.page(selectedGalleryPatterns(),libraryPage);
  for(const id of ['libraryPreviousButton','galleryPreviousBottom'])document.getElementById(id).disabled=disabled||state.current===0;
  for(const id of ['libraryNextButton','galleryNextBottom'])document.getElementById(id).disabled=disabled||state.current+1>=state.pages;
  document.getElementById('galleryGridButton').setAttribute('aria-pressed',String(galleryLayout==='grid'));
  document.getElementById('galleryListButton').setAttribute('aria-pressed',String(galleryLayout==='list'));
}
function renderGallery(){
  populateGalleryFilters();GalleryPreviews.reset();
  const list=document.getElementById('libraryPatternList');list.replaceChildren();list.className=`pattern-gallery ${galleryLayout==='list'?'list-view':''}`;
  list.dataset.query=galleryQuery;
  const selection=GalleryModel.page(selectedGalleryPatterns(),libraryPage);libraryPage=selection.current;
  const total=libraryCatalog?.patterns.filter(p=>p.present).length||0;
  const summary=`결과 ${selection.total}개 / 전체 ${total}개 · ${selection.current+1} / ${selection.pages}쪽`;
  document.getElementById('libraryPageSummary').textContent=summary;document.getElementById('galleryBottomSummary').textContent=summary;
  if(!selection.items.length){const empty=document.createElement('p');empty.className='empty gallery-empty';empty.textContent=libraryCatalog?(total?'검색 조건에 맞는 PDF가 없습니다. 조건을 지우고 다시 확인하세요.':'이 폴더에 PDF가 없습니다.'):'패턴 폴더를 연결하면 PDF 갤러리가 표시됩니다.';list.append(empty);}
  const files=new Map(indexedLibraryFiles.map(file=>[file.path,file]));
  for(const pattern of selection.items){
    const file=files.get(pattern.path);if(!file)continue;
    const card=document.createElement('details');card.className='library-pattern';card.dataset.patternId=pattern.id;card.dataset.preview='pending';
    const header=document.createElement('summary'),visual=document.createElement('div');visual.className='pattern-thumbnail';
    const image=document.createElement('img');image.hidden=true;image.alt=`${file.name} 대표 ${GalleryModel.representative(pattern)}페이지`;image.decoding='async';
    const placeholder=document.createElement('div');placeholder.className='thumbnail-placeholder';placeholder.textContent='미리보기 대기';visual.append(image,placeholder);
    const info=document.createElement('div');info.className='pattern-info';
    const title=document.createElement('span');title.className='pattern-title';title.textContent=file.name.replace(/\.pdf$/i,'');
    const designer=document.createElement('span');designer.className='pattern-designer';designer.textContent=GalleryModel.designer(pattern)||'루트·특수 폴더';
    const path=document.createElement('span');path.className='pattern-path';path.textContent=pattern.path;
    const labels=document.createElement('span');labels.className='category-labels';labels.textContent=pattern.categoryIds.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(' · ');
    const caption=document.createElement('span');caption.className='pattern-page-caption';caption.textContent=`대표 ${GalleryModel.representative(pattern)}페이지`;
    const hint=document.createElement('span');hint.className='pattern-edit-hint';hint.textContent='분류·대표 페이지 편집';info.append(title,designer,path,labels,caption,hint);header.append(visual,info);card.append(header);
    card.addEventListener('toggle',()=>{if(card.open&&card.children.length===1)mountGalleryEditor(card,pattern,file);});
    list.append(card);if(libraryCategoryDrafts.has(pattern.id)||libraryPageDrafts.has(pattern.id))card.open=true;
    GalleryPreviews.observe({card,image,placeholder,caption,pattern,file});
  }
  renderGalleryControls();
}
function mountGalleryEditor(card,pattern,file){
  const editor=document.createElement('div');editor.className='gallery-editor';
  if(pattern.analysis){
    const result=document.createElement('p');result.className='note';
    const labels={done:'분석 완료','no-text':'텍스트 없음 · 스캔 PDF는 수동 분류하세요.',uncertain:'확실한 분류 없음 또는 파일명 분류와 충돌 · 기존 분류 유지',error:pattern.analysis.error};
    result.textContent=`PDF 텍스트 · ${labels[pattern.analysis.status]} · ${pattern.analysis.pages}페이지 확인${pattern.categorySource==='manual'?' · 수동 분류 유지':''}`;
    if(pattern.analysis.matches.length)result.textContent+=` · 제목에서 찾은 분류: ${pattern.analysis.matches.map(id=>libraryCatalog.categories.find(c=>c.id===id)?.name).join(', ')}`;
    editor.append(result);
  }
  let ids=[...(libraryCategoryDrafts.get(pattern.id)||pattern.categoryIds)];
  const notice=document.createElement('p');notice.className='note';notice.textContent=libraryCategoryDrafts.has(pattern.id)?'편집 중 · 분류 저장을 눌러주세요.':'분류를 선택한 뒤 저장하세요.';
  editor.append(categoryPicker(ids,value=>{ids=value;libraryCategoryDrafts.set(pattern.id,[...value]);notice.textContent='편집 중 · 분류 저장을 눌러주세요.';},`${pattern.path} 카테고리`),notice);
  const actions=document.createElement('div');actions.className='gallery-editor-actions';
  const button=(text,callback)=>{const node=document.createElement('button');node.type='button';node.className='secondary-button';node.textContent=text;node.onclick=callback;actions.append(node);return node;};
  button('분류 저장',()=>catalogAction(async()=>{const next=structuredClone(libraryCatalog);const target=next.patterns.find(p=>p.id===pattern.id);target.categoryIds=ids;target.categorySource='manual';await persistCatalog(next);libraryCategoryDrafts.delete(pattern.id);})).dataset.catalogControl='';
  button('변경 취소',()=>{libraryCategoryDrafts.delete(pattern.id);libraryPageDrafts.delete(pattern.id);renderLibraryPatterns();});
  button('PDF 열기',()=>openReviewPdf(file));editor.append(actions);
  const pageTools=document.createElement('div');pageTools.className='representative-page-tools';
  const label=document.createElement('label');label.textContent='대표 페이지';label.htmlFor=`representative-${pattern.id}`;
  const input=document.createElement('input');input.id=label.htmlFor;input.type='number';input.min='1';input.step='1';input.value=libraryPageDrafts.get(pattern.id)??GalleryModel.representative(pattern);input.className='text-input representative-page-input';if(card.dataset.pages)input.max=card.dataset.pages;
  input.oninput=()=>{libraryPageDrafts.set(pattern.id,input.value);};
  const savePage=document.createElement('button');savePage.type='button';savePage.className='secondary-button';savePage.textContent='대표 페이지 저장';savePage.dataset.catalogControl='';
  savePage.onclick=()=>catalogAction(async()=>{
    const number=Number(input.value);if(!Number.isSafeInteger(number)||number<1)throw new Error('대표 페이지는 1 이상의 정수로 입력하세요.');
    await GalleryPreviews.obtain(file,pattern,number);
    const next=structuredClone(libraryCatalog);next.patterns.find(p=>p.id===pattern.id).representativePage=number;await persistCatalog(next);libraryPageDrafts.delete(pattern.id);
  });
  pageTools.append(label,input,savePage);editor.append(pageTools);card.append(editor);
  renderCatalogControls();if(operationBusy)setOperationBusy(true);
}
function initializeGalleryControls(){
  let searchTimer;
  const changed=()=>{libraryPage=0;renderLibraryPatterns();};
  document.getElementById('librarySearch').oninput=event=>{galleryQuery=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(changed,150);};
  document.getElementById('libraryCategoryFilter').onchange=event=>{galleryCategory=event.target.value;changed();};
  document.getElementById('libraryDesignerFilter').onchange=event=>{galleryDesigner=event.target.value;changed();};
  document.getElementById('librarySort').onchange=event=>{gallerySort=event.target.value;changed();};
  for(const mode of ['grid','list'])document.getElementById(mode==='grid'?'galleryGridButton':'galleryListButton').onclick=()=>{galleryLayout=mode;try{localStorage.setItem('pdfOrganizerLibraryLayout',mode);}catch{}renderLibraryPatterns();};
  document.getElementById('clearGalleryFiltersButton').onclick=()=>{clearTimeout(searchTimer);galleryQuery='';galleryCategory='';galleryDesigner='';document.getElementById('librarySearch').value='';changed();};
  document.getElementById('clearThumbnailCacheButton').onclick=async()=>{
    if(operationBusy)return;GalleryPreviews.suspend();setOperationBusy(true);
    let failed=false;
    try{await ThumbnailStore.clear();}catch{failed=true;}
    finally{setOperationBusy(false);renderLibraryPatterns();if(failed){const status=document.getElementById('previewStatus');status.dataset.override='true';status.textContent='캐시를 비우지 못했습니다. 다시 시도하세요.';}}
  };
  document.getElementById('galleryPreviousBottom').onclick=()=>{libraryPage--;renderLibraryPatterns();};
  document.getElementById('galleryNextBottom').onclick=()=>{libraryPage++;renderLibraryPatterns();};
}
