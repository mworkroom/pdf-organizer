// Incoming covers are optional, local images. They never change review metadata.
const ReviewPreviews=(()=>{
  const margin=500,jobs=new Set(),urls=new Set();
  let generation=0,observer,queue=[],busy=false,controller;
  const totals={rendered:0,hits:0,failed:0};
  const current=job=>job.token===generation&&job.cover.isConnected;
  const enabled=()=>activeView==='organize'&&!operationBusy&&!draftLockedElsewhere;
  const distance=job=>{
    const bounds=job.cover.getBoundingClientRect();
    return bounds.bottom<0?-bounds.bottom:bounds.top>innerHeight?bounds.top-innerHeight:0;
  };
  function reset(){
    generation++;observer?.disconnect();controller?.abort();queue=[];jobs.clear();
    for(const url of urls)URL.revokeObjectURL(url);urls.clear();
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const job=entry.target._coverJob;
        if(entry.isIntersecting&&current(job)&&job.state==='pending'){
          job.state='queued';queue.push(job);
        }
      }
      pump();
    },{rootMargin:`${margin}px 0px`});
  }
  function observe(file,cover,image,placeholder,caption,retry){
    const job={file,cover,image,placeholder,caption,retry,token:generation,state:'pending'};
    cover._coverJob=job;jobs.add(job);observer.observe(cover);
    retry.onclick=()=>{
      if(!enabled()||!current(job))return;
      retry.hidden=true;placeholder.textContent='Preview pending';job.state='pending';
      job.cover.dataset.preview='pending';observer.observe(cover);resume();
    };
  }
  async function obtain(job,signal){
    const file=job.file,key=JSON.stringify(['review-cover-v1',file.patternId,file.name,file.size,file.lastModified,1]);
    let cached;
    try{cached=await ThumbnailStore.get(key);}catch{}
    if(signal.aborted)throw new DOMException('Preview request canceled','AbortError');
    if(cached?.blob instanceof Blob&&cached.blob.size>0&&cached.page===1&&Number.isSafeInteger(cached.pages)&&cached.pages>=1){totals.hits++;return cached;}
    const result=await PdfPreview.render(file.handle,file,1,signal);
    if(signal.aborted)throw new DOMException('Preview request canceled','AbortError');
    totals.rendered++;
    try{await ThumbnailStore.put(key,result);}catch{}
    return result;
  }
  async function pump(){
    if(busy||!enabled())return;
    queue.sort((a,b)=>distance(a)-distance(b));
    let job;
    while(queue.length){
      const candidate=queue.shift();
      if(!current(candidate))continue;
      if(distance(candidate)>margin){candidate.state='pending';continue;}
      job=candidate;break;
    }
    if(!job)return;
    busy=true;controller=new AbortController();const signal=controller.signal;
    job.state='loading';job.placeholder.textContent='Loading cover...';job.cover.dataset.preview='loading';
    try{
      const result=await obtain(job,signal);
      if(!current(job)||signal.aborted)return;
      const url=URL.createObjectURL(result.blob);urls.add(url);
      job.image.src=url;job.image.hidden=false;job.placeholder.hidden=true;
      job.caption.textContent='Cover · click to open PDF';job.cover.dataset.preview='ready';job.state='ready';observer.unobserve(job.cover);
    }catch(error){
      if(!current(job))return;
      if(signal.aborted||error.name==='AbortError'){
        job.state='pending';job.placeholder.textContent='Preview pending';job.cover.dataset.preview='pending';
      }else{
        totals.failed++;job.state='error';job.cover.dataset.preview='error';observer.unobserve(job.cover);
        job.placeholder.textContent=error.name==='PasswordException'?'Password-protected PDF':error.message.includes('changed')?'File changed. Reconnect the download folder.':'Cover unavailable';
        job.caption.textContent='Open the PDF to check the contents.';job.retry.hidden=false;job.retry.disabled=!enabled();
      }
    }finally{
      if(current(job)&&job.state==='loading'&&signal.aborted){
        job.state='pending';job.placeholder.textContent='Preview pending';job.cover.dataset.preview='pending';
      }
      busy=false;resume();
    }
  }
  function suspend(){
    observer?.disconnect();controller?.abort();queue=[];
    for(const job of jobs)if(job.state==='queued')job.state='pending';
  }
  function resume(){
    if(!enabled())return;
    for(const job of jobs)if(current(job)&&job.state==='pending')observer.observe(job.cover);
    pump();
  }
  return {reset,observe,resume,suspend,get stats(){return {...totals,busy,queued:queue.length,jobs:jobs.size,urls:urls.size};}};
})();
