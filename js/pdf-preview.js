const PdfPreview=(()=>{
  let modulePromise, serial=Promise.resolve();
  let active=0,maxActive=0,reads=0;
  const aborted=()=>new DOMException('미리보기 요청 취소','AbortError');
  function library(){
    if(!modulePromise)modulePromise=import(new URL('vendor/pdfjs/build/pdf.min.mjs',document.baseURI).href).then(module=>{
      module.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs/build/pdf.worker.min.mjs',document.baseURI).href;return module;
    }).catch(error=>{modulePromise=null;throw error;});
    return modulePromise;
  }
  async function draw(handle,pattern,pageNumber,signal,extract=false){
    if(signal?.aborted)throw aborted();
    const file=await handle.getFile();
    if(file.size!==pattern.size||file.lastModified!==pattern.lastModified)throw new Error('파일이 변경됐습니다. 패턴 목록을 새로고침하세요.');
    const pdfjs=await library();
    if(signal?.aborted)throw aborted();
    const bytes=new Uint8Array(await file.arrayBuffer());
    reads++;
    if(signal?.aborted)throw aborted();
    // Hash while the bytes are still owned here: PDF.js may transfer them to its worker.
    const sha256=extract?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''):null;
    if(signal?.aborted)throw aborted();
    const base=new URL('vendor/pdfjs/',document.baseURI);
    const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,verbosity:0,
      cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,
      standardFontDataUrl:new URL('standard_fonts/',base).href,
      wasmUrl:new URL('wasm/',base).href,iccUrl:new URL('iccs/',base).href,canvasMaxAreaInBytes:16*1024*1024});
    const cancel=()=>task.destroy().catch(()=>{});
    signal?.addEventListener('abort',cancel,{once:true});
    let canvas;
    try{
      const pdf=await task.promise;
      if(signal?.aborted)throw aborted();
      if(extract){
        const pages=[];
        for(let number=1;number<=Math.min(3,pdf.numPages);number++){
          if(signal?.aborted)throw aborted();
          const page=await pdf.getPage(number),content=await page.getTextContent();
          const lines=[];let line=null,total=0;
          for(const item of content.items){
            if(typeof item.str!=='string')continue;
            const y=item.transform[5],height=Math.hypot(item.transform[2],item.transform[3]);
            if(!line||Math.abs(line.y-y)>Math.max(2,height*.3)){line={text:'',height,y};lines.push(line);}
            line.text+=(line.text?' ':'')+item.str;line.height=Math.max(line.height,height);total+=item.str.length;
            if(item.hasEOL)line=null;
            if(total>100000)break;
          }
          pages.push({lines});page.cleanup();
        }
        if(signal?.aborted)throw aborted();
        return {pages,sha256};
      }
      if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>pdf.numPages)throw Object.assign(new Error(`대표 페이지는 1~${pdf.numPages} 사이로 선택하세요.`),{numPages:pdf.numPages});
      const page=await pdf.getPage(pageNumber),original=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(384/original.width,480/original.height)});
      canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'}).promise;
      if(signal?.aborted)throw aborted();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.85));
      if(signal?.aborted)throw aborted();
      if(!blob)throw new Error('미리보기 이미지를 만들지 못했습니다.');
      return {blob,pages:pdf.numPages,page:pageNumber};
    }finally{
      signal?.removeEventListener('abort',cancel);await task.destroy();
      if(canvas){canvas.width=0;canvas.height=0;}
    }
  }
  function schedule(handle,pattern,pageNumber,signal,extract){
    // All gallery and representative-page renders share one serial PDF worker slot.
    const result=serial.then(async()=>{active++;maxActive=Math.max(maxActive,active);try{return await draw(handle,pattern,pageNumber,signal,extract);}finally{active--;}});serial=result.catch(()=>{});return result;
  }
  const render=(handle,pattern,pageNumber,signal)=>schedule(handle,pattern,pageNumber,signal,false);
  const extractText=(handle,pattern,signal)=>schedule(handle,pattern,1,signal,true);
  return {render,extractText,get stats(){return {active,maxActive,reads};}};
})();
