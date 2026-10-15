// Pure classification and relinking rules. Ordinary indexing never hashes PDFs.
const MaintenanceModel=(()=>{
  function inferText(pages,categories){
    const matches=new Set();
    for(const [index,page] of pages.entries()){
      const largest=Math.max(0,...page.lines.map(line=>line.height));
      for(const line of page.lines){
        const text=line.text.trim();
        // Cover headings and explicit type labels only. Instructions/material lists are weak evidence.
        if(!text||text.length>100||text.split(/\s+/).length>12||/materials?|needles?|gauge|abbreviations?|instructions?|cast on|stitches|준비물|바늘|게이지|뜨는 방법/i.test(text))continue;
        const explicit=/^(?:pattern type|category|도안 종류|종류)\s*[:：]/i.test(text);
        const exact=categories.some(c=>c.keywords.some(k=>k.toLocaleLowerCase()===text.toLocaleLowerCase()));
        if(!explicit&&!exact&&!(index===0&&line.height>=Math.max(14,largest*.8)))continue;
        for(const id of CatalogModel.infer(text,categories))if(id!=='unknown')matches.add(id);
      }
    }
    return [...matches];
  }
  function applyAnalysis(pattern,result,categories){
    const next=structuredClone(pattern),matches=inferText(result.pages,categories);
    const hasText=result.pages.some(p=>p.lines.some(l=>l.text.trim()));
    next.sha256=result.sha256;
    next.analysis={version:1,status:hasText?(matches.length?'done':'uncertain'):'no-text',pages:result.pages.length,matches,at:new Date().toISOString()};
    if(pattern.categorySource!=='manual'&&matches.length){
      const current=pattern.categoryIds.filter(id=>id!=='unknown');
      if(current.length&&current.some(id=>!matches.includes(id))){next.analysis.status='uncertain';}
      else{next.categoryIds=CatalogModel.categoryIds(matches,categories);next.categorySource='pdf-text';}
    }
    return next;
  }
  function candidates(catalog,missing){
    // Same size narrows reads; size or modification time alone never proves identity.
    return catalog.patterns.filter(p=>p.present&&p.id!==missing.id&&p.size===missing.size);
  }
  function relink(catalog,missingId,candidateId,sha256,verified){
    const next=structuredClone(catalog),old=next.patterns.find(p=>p.id===missingId),candidate=next.patterns.find(p=>p.id===candidateId);
    if(!old||old.present||!candidate?.present||old.size!==candidate.size)throw new Error('복구 대상이 변경됐습니다. 목록을 새로고침하세요.');
    if(verified&&(!old.sha256||old.sha256!==sha256))throw new Error('저장된 해시와 일치하지 않습니다.');
    if(candidate.categorySource==='manual')throw new Error('후보 파일에 수동 분류가 있습니다. 기존 분류를 덮어쓰지 않습니다.');
    Object.assign(old,{path:candidate.path,size:candidate.size,lastModified:candidate.lastModified,present:true,sha256});
    // Keep the full displaced record for inspection/recovery, but never offer it as another missing file.
    candidate.present=false;candidate.mergedInto=old.id;
    return next;
  }
  return {inferText,applyAnalysis,candidates,relink};
})();
