// Durable metadata model. PDF contents are never needed for ordinary indexing.
const CatalogModel = (() => {
  const definitions = [
    ['Sweater','sweater,pullover,jumper,스웨터,풀오버'], ['Cardigan','cardigan,카디건,가디건'],
    ['Vest','vest,조끼,베스트'], ['Top','top,tee,tank,티셔츠,탑'],
    ['Scarf','scarf,목도리,스카프'], ['Shawl','shawl,숄'], ['Cowl','cowl,넥워머,카울'],
    ['Hat','hat,beanie,비니,모자'], ['Hood','hood,후드'], ['Socks','sock,socks,양말'],
    ['Mittens','mitten,mittens,벙어리장갑'], ['Gloves','glove,gloves,장갑'],
    ['Bag','bag,tote,가방'], ['Blanket','blanket,담요'], ['Poncho','poncho,판초'],
    ['Dress','dress,원피스'], ['Skirt','skirt,스커트,치마'], ['Cushion','cushion,pillow,쿠션'],
    ['Home Accessories',''], ['Toy','toy,인형'], ['Small Accessories',''], ['Other',''], ['Unknown','']
  ];
  const idFor = name => name.toLowerCase().replaceAll(' ', '-');
  const create = () => ({version:1, revision:0, libraryId:crypto.randomUUID(), categories:definitions.map(([name, words])=>({id:idFor(name),name,keywords:words?words.split(','):[]})), patterns:[]});
  function categoryIds(ids, categories) {
    const known=new Set(categories.map(c=>c.id));
    const result=[...new Set((Array.isArray(ids)?ids:[]).filter(id=>known.has(id)))];
    return result.some(id=>id!=='unknown')?result.filter(id=>id!=='unknown'):['unknown'];
  }
  function infer(name, categories) {
    // Literal, complete words only: "hat" must not match "that" or "hatfield".
    const normalized=name.replace(/\.pdf$/i,'').normalize('NFKC').toLowerCase().replace(/[_\-]+/g,' ');
    const tokens=normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
    const matches=categories.filter(c=>!['other','unknown'].includes(c.id)&&c.keywords.some(word=>{
      const phrase=word.normalize('NFKC').toLowerCase().replace(/[_\-]+/g,' ').trim();
      return phrase && (` ${tokens} `).includes(` ${phrase} `);
    })).map(c=>c.id);
    return categoryIds(matches,categories);
  }
  function validate(value) {
    const fail=()=>{throw new Error('Invalid metadata format or unsupported version. The original JSON will not be overwritten.');};
    if(!value||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.libraryId!=='string'||!value.libraryId||!Array.isArray(value.categories)||!Array.isArray(value.patterns))fail();
    const ids=new Set(), names=new Set(), patterns=new Set(), livePaths=new Set();
    for(const c of value.categories){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||names.has(c.name.trim().toLowerCase())||!Array.isArray(c.keywords)||c.keywords.some(k=>typeof k!=='string'||!k.trim()))fail();
      ids.add(c.id); names.add(c.name.trim().toLowerCase());
    }
    if(!ids.has('unknown')||!ids.has('other'))fail();
    for(const p of value.patterns){
      if(!p||typeof p.id!=='string'||!p.id||patterns.has(p.id)||typeof p.path!=='string'||!p.path||p.path.startsWith('/')||p.path.split('/').some(s=>!s||s==='.'||s==='..')||!Number.isFinite(p.size)||p.size<0||!Number.isFinite(p.lastModified)||typeof p.present!=='boolean'||!Array.isArray(p.categoryIds)||!p.categoryIds.length||p.categoryIds.some(id=>!ids.has(id))||new Set(p.categoryIds).size!==p.categoryIds.length|| (p.categoryIds.includes('unknown')&&p.categoryIds.length>1)||!['manual','filename','pdf-text'].includes(p.categorySource))fail();
      if(p.present&&livePaths.has(p.path))fail();
      if(p.representativePage!==undefined&&(!Number.isSafeInteger(p.representativePage)||p.representativePage<1))fail();
      if(p.designerName!==undefined&&typeof p.designerName!=='string')fail();
      if(p.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(p.sha256))fail();
      if(p.mergedInto!==undefined&&(typeof p.mergedInto!=='string'||!p.mergedInto||p.mergedInto===p.id||p.present))fail();
      if(p.analysis!==undefined&&(!p.analysis||p.analysis.version!==1||!['done','no-text','uncertain','error'].includes(p.analysis.status)||!Number.isSafeInteger(p.analysis.pages)||p.analysis.pages<0||p.analysis.pages>3||typeof p.analysis.at!=='string'||!Array.isArray(p.analysis.matches)||p.analysis.matches.some(id=>!ids.has(id))||(p.analysis.error!==undefined&&typeof p.analysis.error!=='string')))fail();
      patterns.add(p.id); if(p.present)livePaths.add(p.path);
    }
    if(value.patterns.some(p=>p.mergedInto&&!patterns.has(p.mergedInto)))fail();
    return value;
  }
  function reconcile(catalog, files) {
    const next=structuredClone(catalog);
    const existing=new Map(next.patterns.filter(p=>!p.mergedInto).sort((a,b)=>Number(a.present)-Number(b.present)).map(p=>[p.path,p]));
    next.patterns.forEach(p=>p.present=false);
    for(const file of files){
      let pattern=existing.get(file.path);
      if(!pattern||pattern.size!==file.size||pattern.lastModified!==file.lastModified){
        // A replacement at the same path is a new pattern. Retain the old record for later repair.
        pattern={id:crypto.randomUUID(),path:file.path,size:file.size,lastModified:file.lastModified,categoryIds:infer(file.name,next.categories),categorySource:'filename',representativePage:1};
        next.patterns.push(pattern);
      }
      pattern.present=true;
    }
    return next;
  }
  function removeCategory(catalog, id, replacement) {
    if(['unknown','other'].includes(id))throw new Error('Other and Unknown cannot be deleted.');
    if(id===replacement||!catalog.categories.some(c=>c.id===replacement))throw new Error('Select a replacement category.');
    catalog.categories=catalog.categories.filter(c=>c.id!==id);
    for(const p of catalog.patterns)if(p.analysis)p.analysis.matches=p.analysis.matches.filter(c=>c!==id);
    for(const p of catalog.patterns){
      if(p.categoryIds.includes(id)){p.categoryIds=categoryIds(p.categoryIds.map(c=>c===id?replacement:c),catalog.categories);p.categorySource='manual';}
    }
  }
  function replaceCategories(catalog, patternIds, replacementIds) {
    const targets=new Set(patternIds);
    const known=new Set(catalog.categories.map(category=>category.id));
    if(!targets.size)throw new Error('Select patterns first.');
    if(!replacementIds.length||replacementIds.some(id=>!known.has(id)))throw new Error('Choose valid replacement categories.');
    const present=new Set(catalog.patterns.filter(pattern=>pattern.present).map(pattern=>pattern.id));
    if([...targets].some(id=>!present.has(id)))throw new Error('Selected patterns have changed. Refresh the library and select them again.');
    const next=structuredClone(catalog),ids=categoryIds(replacementIds,catalog.categories);
    for(const pattern of next.patterns)if(targets.has(pattern.id)){
      pattern.categoryIds=[...ids];pattern.categorySource='manual';
    }
    return validate(next);
  }
  return {create,validate,infer,categoryIds,reconcile,removeCategory,replaceCategories};
})();
