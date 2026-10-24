let galleryFavoritesOnly=false,designerFavoritesOnly=false;

function favoriteDesignerNames(){return libraryCatalog?.favoriteDesigners||[];}
function isFavoriteDesigner(name){return favoriteDesignerNames().includes(name);}
function favoriteDesignerButton(name){
  const button=document.createElement('button'),favorite=isFavoriteDesigner(name);
  button.type='button';button.className='designer-favorite-button secondary-button';button.dataset.designerFavorite=name;
  button.textContent=favorite?'★':'☆';button.setAttribute('aria-pressed',String(favorite));
  button.setAttribute('aria-label',`${favorite?'Remove':'Add'} ${name} ${favorite?'from':'to'} favorites`);
  button.title=button.getAttribute('aria-label');button.onclick=()=>toggleDesignerFavorite(name);
  button.disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  return button;
}
function favoriteDesignerStatus(message){
  for(const id of ['galleryFavoriteStatus','designerFavoriteStatus'])document.getElementById(id).textContent=message;
}
function toggleDesignerFavorite(name){
  if(operationBusy||draftLockedElsewhere||!libraryCatalog||catalogError)return;
  return catalogAction(async()=>{
    favoriteDesignerStatus('Saving favorite designers...');
    try{
      const next=structuredClone(libraryCatalog),favorite=isFavoriteDesigner(name);
      next.favoriteDesigners=favorite?favoriteDesignerNames().filter(item=>item!==name):[...favoriteDesignerNames(),name];
      await persistCatalog(next);
      if(galleryFavoritesOnly){
        libraryPage=0;
        clearLibrarySelection(librarySelection.size?'Selection cleared because favorite designers changed.':'');
      }
      favoriteDesignerStatus(`${favorite?'Removed':'Added'} ${name} ${favorite?'from':'to'} favorites.`);
    }catch(error){
      favoriteDesignerStatus(`Could not save favorite designers: ${error.message}`);
      throw error;
    }
  });
}
function renderDesignerFavoriteControls(){
  const disabled=operationBusy||draftLockedElsewhere||!libraryCatalog||Boolean(catalogError);
  for(const [prefix,only] of [['gallery',galleryFavoritesOnly],['designer',designerFavoritesOnly]]){
    for(const [suffix,pressed] of [['AllDesignersButton',!only],['FavoritesButton',only]]){
      const button=document.getElementById(prefix+suffix);button.disabled=disabled;button.setAttribute('aria-pressed',String(pressed));
    }
  }
  document.querySelectorAll('[data-designer-favorite]').forEach(button=>button.disabled=disabled);
}
function initializeDesignerFavorites(){
  for(const [suffix,only] of [['AllDesignersButton',false],['FavoritesButton',true]]){
    document.getElementById('gallery'+suffix).onclick=()=>{
      galleryFavoritesOnly=only;gallerySearchPending=false;libraryPage=0;
      if(only&&galleryDesigner&&!isFavoriteDesigner(galleryDesigner))galleryDesigner='';
      clearLibrarySelection(librarySelection.size?'Selection cleared because the designer scope changed.':'');
      renderLibraryPatterns();
    };
    document.getElementById('designer'+suffix).onclick=()=>{designerFavoritesOnly=only;renderDesignerFolders(designerFolders);renderDesignerFavoriteControls();};
  }
}
