const GalleryModel = (() => {
  const pageSize=24;
  const collator=new Intl.Collator('ko',{numeric:true,sensitivity:'base'});
  const normalize=text=>String(text||'').normalize('NFKC').toLocaleLowerCase().replace(/[_\-]+/g,' ').replace(/\s+/g,' ').trim();
  function designer(pattern){
    const parts=pattern.path.split('/');
    if(parts.length===1)return pattern.designerName||'';
    if(parts[0]==='!zz_Singles')return pattern.designerName||parts.at(-1).split('_')[0] || '';
    if(parts[0].startsWith('!'))return pattern.designerName||'';
    return parts[0];
  }
  function select(catalog,{query='',category='',attributes=[],designerName='',sort='name'}={}){
    if(!catalog)return [];
    const terms=normalize(query).split(' ').filter(Boolean);
    const names=new Map(catalog.categories.map(c=>[c.id,c.name]));
    const patterns=catalog.patterns.filter(p=>p.present&&(!category||p.categoryIds.includes(category))&&attributes.every(id=>(p.attributeIds||[]).includes(id))&&(!designerName||designer(p)===designerName)&&terms.every(term=>normalize([p.path,designer(p),...p.categoryIds.map(id=>names.get(id)),...(p.attributeIds||[])].join(' ')).includes(term)));
    const titles=new Map(patterns.map(p=>[p.id,p.path.slice(p.path.lastIndexOf('/')+1)]));
    const designers=sort==='designer'?new Map(patterns.map(p=>[p.id,designer(p)])):null;
    return patterns.sort((a,b)=>{
      if(sort==='recent')return b.lastModified-a.lastModified || collator.compare(a.path,b.path);
      if(sort==='designer'){const diff=collator.compare(designers.get(a.id),designers.get(b.id));if(diff)return diff;}
      return collator.compare(titles.get(a.id),titles.get(b.id)) || collator.compare(a.path,b.path);
    });
  }
  function page(patterns,index){
    const pages=Math.max(1,Math.ceil(patterns.length/pageSize));
    const current=Math.min(Math.max(0,index),pages-1);
    return {items:patterns.slice(current*pageSize,(current+1)*pageSize),current,pages,total:patterns.length};
  }
  function representative(pattern){return pattern.representativePage ?? 1;}
  function cacheKey(libraryId,pattern,pageNumber=representative(pattern)){
    return JSON.stringify(['pdfjs-6.4.299-preview-1',libraryId,pattern.id,pattern.size,pattern.lastModified,pageNumber]);
  }
  return {pageSize,normalize,designer,select,page,representative,cacheKey};
})();
