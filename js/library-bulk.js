// Selection belongs to library metadata, independently of incoming file batches.
let librarySelectionMode=false,librarySelectionId='',libraryBulkCategories=[],libraryBulkMessage='';
let libraryBulkAttributes=[];
const librarySelection=new Map();
let libraryBulkCategoryKey='';
const libraryPatternSignature=pattern=>JSON.stringify([pattern.path,pattern.size,pattern.lastModified]);

function clearLibrarySelection(message=''){
  librarySelection.clear();libraryBulkMessage=message;
}
function reconcileLibrarySelection(){
  const id=libraryCatalog?.libraryId||'';
  if(librarySelectionId!==id){
    librarySelectionId=id;librarySelectionMode=false;libraryBulkCategories=[];libraryBulkAttributes=[];clearLibrarySelection();
    document.getElementById('libraryBulkCategoryPicker').replaceChildren();
    document.getElementById('libraryBulkAttributePicker').replaceChildren();
  }
  const patterns=new Map((libraryCatalog?.patterns||[]).filter(pattern=>pattern.present).map(pattern=>[pattern.id,pattern]));
  for(const [id,signature] of librarySelection){
    const pattern=patterns.get(id);
    if(!pattern||signature!==libraryPatternSignature(pattern))librarySelection.delete(id);
  }
}
function addLibrarySelectionControl(card,pattern){
  if(!librarySelectionMode)return;
  const label=document.createElement('label');label.className='library-card-selection';
  const input=document.createElement('input');input.type='checkbox';input.dataset.librarySelection=pattern.id;
  input.setAttribute('aria-label',`Select pattern ${pattern.path}`);input.checked=librarySelection.has(pattern.id);
  const caption=document.createElement('span');caption.textContent='Select pattern';label.append(input,caption);
  input.onchange=()=>{
    if(operationBusy||draftLockedElsewhere||gallerySearchPending)return;
    if(input.checked)librarySelection.set(pattern.id,libraryPatternSignature(pattern));else librarySelection.delete(pattern.id);
    libraryBulkMessage='';renderLibraryBulkControls();
  };
  card.querySelector('.pattern-card-header').prepend(label);
}
function renderLibraryBulkControls(){
  const disabled=operationBusy||draftLockedElsewhere||gallerySearchPending||!libraryCatalog||Boolean(catalogError);
  const results=selectedGalleryPatterns(),page=GalleryModel.page(results,libraryPage);
  const select=document.getElementById('librarySelectButton');
  select.disabled=disabled;select.setAttribute('aria-pressed',String(librarySelectionMode));
  select.textContent=librarySelectionMode?'Done selecting':'Select patterns';
  document.getElementById('libraryBulkTools').classList.toggle('hidden',!librarySelectionMode);
  document.getElementById('librarySelectionCount').textContent=`${librarySelection.size} selected`;
  document.getElementById('libraryBulkStatus').textContent=libraryBulkMessage;
  const pageButton=document.getElementById('selectLibraryPageButton');
  pageButton.textContent=`Select this page (${page.items.length})`;pageButton.disabled=disabled||!page.items.length;
  const resultsButton=document.getElementById('selectLibraryResultsButton');
  resultsButton.textContent=`Select all ${results.length} results`;resultsButton.disabled=disabled||!results.length;
  document.getElementById('clearLibrarySelectionButton').disabled=disabled||!librarySelection.size;
  const categories=availableCategories(),key=JSON.stringify(categories.map(category=>[category.id,category.name]));
  if(librarySelectionMode&&(key!==libraryBulkCategoryKey||!document.getElementById('libraryBulkCategoryPicker').children.length)){
    libraryBulkCategoryKey=key;
    libraryBulkCategories=libraryBulkCategories.filter(id=>categories.some(category=>category.id===id));
    const picker=document.getElementById('libraryBulkCategoryPicker');
    picker.replaceChildren(categoryPicker(libraryBulkCategories,ids=>{
      libraryBulkCategories=ids;libraryBulkMessage='';renderLibraryBulkControls();
    },'Replacement categories (select one or more)',true));
  }
  document.getElementById('applyLibraryCategoriesButton').disabled=disabled||!librarySelection.size||!libraryBulkCategories.length;
  const attributeHost=document.getElementById('libraryBulkAttributePicker');
  if(librarySelectionMode&&!attributeHost.children.length)attributeHost.append(attributePicker(libraryBulkAttributes,ids=>{
    libraryBulkAttributes=ids;libraryBulkMessage='';renderLibraryBulkControls();
  },'Replacement attributes'));
  document.getElementById('applyLibraryAttributesButton').disabled=disabled||!librarySelection.size||!libraryBulkAttributes.length;
  document.getElementById('clearLibraryAttributesButton').disabled=disabled||!librarySelection.size;
  document.querySelectorAll('#libraryBulkCategoryPicker input,#libraryBulkAttributePicker input,[data-library-selection]').forEach(input=>{
    input.disabled=disabled;
    if(input.dataset.librarySelection){
      input.checked=librarySelection.has(input.dataset.librarySelection);
      input.closest('.library-pattern').classList.toggle('bulk-selected',input.checked);
    }
  });
}
function setLibrarySelectionMode(enabled){
  if(operationBusy||draftLockedElsewhere||gallerySearchPending)return;
  librarySelectionMode=enabled;
  if(!enabled){
    clearLibrarySelection();libraryBulkCategories=[];libraryBulkAttributes=[];
    document.getElementById('libraryBulkCategoryPicker').replaceChildren();document.getElementById('libraryBulkAttributePicker').replaceChildren();
  }
  renderLibraryPatterns();
}
function selectLibraryPatterns(allResults){
  if(operationBusy||draftLockedElsewhere||gallerySearchPending||!librarySelectionMode)return;
  const results=selectedGalleryPatterns(),patterns=allResults?results:GalleryModel.page(results,libraryPage).items;
  for(const pattern of patterns)librarySelection.set(pattern.id,libraryPatternSignature(pattern));
  libraryBulkMessage='';renderLibraryBulkControls();
}
async function applyLibraryClassification(kind,clear=false){
  if(operationBusy||draftLockedElsewhere||gallerySearchPending)return;
  try{
    if(!libraryCatalog||catalogError)throw new Error(catalogError||'Connect a pattern folder first.');
    if(hasPendingLibraryEdits())throw new Error('Save or cancel individual category, attribute and cover page edits first.');
    const records=new Map(libraryCatalog.patterns.map(pattern=>[pattern.id,pattern]));
    for(const [id,signature] of librarySelection){
      const pattern=records.get(id);
      if(!pattern?.present||signature!==libraryPatternSignature(pattern))throw new Error('Selected patterns have changed. Select them again.');
    }
    const attributeChange=kind==='attributes',ids=attributeChange?(clear?[]:libraryBulkAttributes):libraryBulkCategories;
    if(attributeChange&&!clear&&!ids.length)throw new Error('Choose replacement attributes or use Clear attributes.');
    const next=attributeChange?CatalogModel.replaceAttributes(libraryCatalog,[...librarySelection.keys()],ids):CatalogModel.replaceCategories(libraryCatalog,[...librarySelection.keys()],ids);
    const count=librarySelection.size,names=attributeChange?ids.join(', '):ids.map(id=>libraryCatalog.categories.find(category=>category.id===id).name).join(', ');
    const confirmation=attributeChange?
      `${clear?'Clear all attributes from':'Replace the attributes of'} ${count} selected patterns${clear?'':` with ${names}`}?\n\nExisting attributes will be replaced. Categories and PDF files will be preserved.`:
      `Replace the categories of ${count} selected patterns with ${names}?\n\nExisting categories will be replaced and saved as manual classifications. PDF files will not be moved or renamed.`;
    if(!window.confirm(confirmation))return;
    GalleryPreviews.suspend();setOperationBusy(true);
    try{
      await persistCatalog(next);
      clearLibrarySelection(attributeChange?`Updated ${count} patterns · Attributes: ${names||'none'}.`:`Updated ${count} patterns · ${names}. Saved as manual categories.`);
    }finally{setOperationBusy(false);renderLibraryPatterns();}
  }catch(error){libraryBulkMessage=`Could not apply ${kind}: ${error.message}`;renderLibraryBulkControls();}
}
async function applyLibraryCategories(){return applyLibraryClassification('categories');}
function initializeLibraryBulkControls(){
  document.getElementById('librarySelectButton').onclick=()=>setLibrarySelectionMode(!librarySelectionMode);
  document.getElementById('selectLibraryPageButton').onclick=()=>selectLibraryPatterns(false);
  document.getElementById('selectLibraryResultsButton').onclick=()=>selectLibraryPatterns(true);
  document.getElementById('clearLibrarySelectionButton').onclick=()=>{clearLibrarySelection();renderLibraryBulkControls();};
  document.getElementById('applyLibraryCategoriesButton').onclick=applyLibraryCategories;
  document.getElementById('applyLibraryAttributesButton').onclick=()=>applyLibraryClassification('attributes');
  document.getElementById('clearLibraryAttributesButton').onclick=()=>applyLibraryClassification('attributes',true);
}
