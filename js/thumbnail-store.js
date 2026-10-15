const ThumbnailStore=(()=>{
  const limit=200, byteLimit=40*1024*1024;
  let opening, unavailable=false;
  function open(){
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('pdfOrganizerPreviewCache',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('previews',{keyPath:'key'});
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('The cache storage is in use.'));
    }).catch(error=>{opening=null;unavailable=true;throw error;});
    return opening;
  }
  async function get(key){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('previews','readwrite'),store=tx.objectStore('previews'),request=store.get(key);let result;
      request.onsuccess=()=>{result=request.result;if(result){result.accessedAt=Date.now();store.put(result);}};
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not read cache'));
    });
  }
  async function put(key,value){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('previews','readwrite'),store=tx.objectStore('previews');
      store.put({...value,key,accessedAt:Date.now()});
      // Trim within the same transaction; a quota failure cannot destroy the old cache.
      const all=store.getAll();
      all.onsuccess=()=>{
        const entries=all.result.sort((a,b)=>a.accessedAt-b.accessedAt);
        let bytes=entries.reduce((sum,item)=>sum+item.blob.size,0),count=entries.length;
        for(const entry of entries){if(count<=limit&&bytes<=byteLimit)break;store.delete(entry.key);bytes-=entry.blob.size;count--;}
      };
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>{unavailable=true;reject(tx.error||new Error('Could not save cache'));};
    });
  }
  async function clear(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('previews','readwrite');tx.objectStore('previews').clear();tx.oncomplete=()=>{unavailable=false;resolve();};tx.onerror=tx.onabort=()=>reject(tx.error);});}
  async function removeLibrary(id){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('previews','readwrite'),store=tx.objectStore('previews'),keys=store.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result){try{if(JSON.parse(key)[1]===id)store.delete(key);}catch{}}};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});}
  return {get,put,clear,removeLibrary,get unavailable(){return unavailable;}};
})();
