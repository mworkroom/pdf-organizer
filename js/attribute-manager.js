function attributeManagerDraft(){
  return [...document.querySelectorAll('.attribute-editor')].map(row=>({id:row.dataset.id,name:row.querySelector('.attribute-name').value.trim()}));
}
function refreshAttributeOrderButtons(){
  const rows=[...document.querySelectorAll('.attribute-editor')];
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  rows.forEach((row,index)=>{
    row.querySelector('[data-attribute-order="-1"]').disabled=disabled||index===0;
    row.querySelector('[data-attribute-order="1"]').disabled=disabled||index===rows.length-1;
  });
}
function renderAttributeManager(){
  if(attributeEditorDirty)return;
  const list=document.getElementById('attributeManagerList');list.replaceChildren();
  if(!libraryCatalog){const empty=document.createElement('p');empty.className='empty';empty.textContent='Connect a pattern folder to manage attributes.';list.append(empty);return;}
  for(const attribute of availableAttributes()){
    const row=document.createElement('div');row.className='attribute-editor';row.dataset.id=attribute.id;
    const name=document.createElement('input');name.className='text-input attribute-name';name.value=attribute.name;name.setAttribute('aria-label',`${attribute.name} Attribute name`);name.dataset.catalogControl='';
    name.oninput=()=>{attributeEditorDirty=true;setCatalogStatus('Editing attributes. Select Save attribute changes when ready.');};
    const tools=document.createElement('div');tools.className='attribute-row-tools';
    for(const [label,offset] of [['Move up',-1],['Move down',1]]){
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=label;button.setAttribute('aria-label',`${attribute.name} Attribute ${label}`);button.dataset.attributeOrder=offset;button.dataset.catalogControl='';
      button.onclick=()=>{
        const target=offset<0?row.previousElementSibling:row.nextElementSibling;
        if(target){if(offset<0)target.before(row);else target.after(row);attributeEditorDirty=true;refreshAttributeOrderButtons();}
      };tools.append(button);
    }
    const replacement=document.createElement('select');replacement.className='text-input';replacement.setAttribute('aria-label',`${attribute.name} Replacement attribute on deletion`);replacement.dataset.catalogControl='';replacement.add(new Option('None (clear assignments)',''));
    for(const other of availableAttributes().filter(item=>item.id!==attribute.id))replacement.add(new Option(other.name,other.id));
    const remove=document.createElement('button');remove.type='button';remove.className='secondary-button';remove.textContent='Delete';remove.setAttribute('aria-label',`${attribute.name} Attribute Delete`);remove.dataset.catalogControl='';
    remove.onclick=()=>{
      if(operationBusy||draftLockedElsewhere)return;
      const replacementId=replacement.value;
      const count=libraryCatalog.patterns.filter(pattern=>pattern.attributeIds?.includes(attribute.id)).length;
      if(!window.confirm(`Delete ${attribute.name}? ${count} library assignments and matching saved reviews will ${replacementId?`be replaced with ${replacement.selectedOptions[0].textContent}`:'be cleared'}. Other pending attribute name and order edits will also be saved.`))return;
      catalogAction(async()=>{
        const next=structuredClone(libraryCatalog);next.attributes=attributeManagerDraft();CatalogModel.validate(next);CatalogModel.removeAttribute(next,attribute.id,replacementId);await persistCatalog(next);
        const replace=ids=>CatalogModel.attributeIds((ids||[]).flatMap(id=>id===attribute.id?(replacementId?[replacementId]:[]):[id]),next.attributes);
        for(const file of getAllReviewFiles())file.attributeIds=replace(file.attributeIds);
        for(const [id,ids] of libraryAttributeDrafts)libraryAttributeDrafts.set(id,replace(ids));
        galleryExcludedAttributes=replace(galleryExcludedAttributes);galleryAttributes=replace(galleryAttributes).filter(id=>!galleryExcludedAttributes.includes(id));libraryBulkAttributes=replace(libraryBulkAttributes);
        if(galleryAttributeMode==='selected'&&!galleryAttributes.length)galleryAttributeMode='any';
        clearLibrarySelection('Selection cleared because the attribute list changed.');attributeEditorDirty=false;
      });
    };
    tools.append(replacement,remove);row.append(name,tools);list.append(row);
  }
  refreshAttributeOrderButtons();
}
function initializeAttributeControls(){
  document.getElementById('saveAttributesButton').onclick=()=>catalogAction(async()=>{
    const next=structuredClone(libraryCatalog);next.attributes=attributeManagerDraft();CatalogModel.validateAttributes(next.attributes);await persistCatalog(next);attributeEditorDirty=false;clearLibrarySelection('Selection cleared because the attribute list changed.');
  });
  document.getElementById('addAttributeButton').onclick=()=>catalogAction(async()=>{
    const input=document.getElementById('newAttributeName'),name=input.value.trim();if(!name)throw new Error('Enter a new attribute name.');
    const next=structuredClone(libraryCatalog);next.attributes=[...attributeManagerDraft(),{id:crypto.randomUUID(),name}];await persistCatalog(next);attributeEditorDirty=false;clearLibrarySelection('Selection cleared because the attribute list changed.');input.value='';
  });
  document.getElementById('cancelAttributeEditsButton').onclick=()=>{attributeEditorDirty=false;document.getElementById('newAttributeName').value='';renderAttributeManager();renderCatalogControls();setCatalogStatus('Attribute edits canceled. Saved assignments are preserved.');};
}
