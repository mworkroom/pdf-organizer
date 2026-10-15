const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto').webcrypto;
function load(){
  const context=vm.createContext({crypto,structuredClone,console,digestCache:new Map(),libraryPageDrafts:new Map(),document:{getElementById(){return {};}}});
  for(const file of ['catalog-model.js','catalog.js','organizer.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  return {context,run:code=>vm.runInContext(code,context)};
}
function record(path='Designer/Sweater.pdf',ids=['sweater'],source='manual'){
  return {id:'pattern-1',path,size:10,lastModified:1,present:true,categoryIds:ids,categorySource:source,representativePage:1};
}
test('23 defaults and conservative English/Korean multiple category inference',()=>{
  const {run}=load();
  assert.equal(run('CatalogModel.create().categories.length'),23);
  for(const [name,ids] of [['sweater-and-hat.pdf',['sweater','hat']],['벙어리장갑.pdf',['mittens']],['Summer_Tee.pdf',['top']],['that_Hatfield.pdf',['unknown']],['Mysterious.pdf',['unknown']],['Mittens Gloves.pdf',['mittens','gloves']]]){
    assert.deepEqual(JSON.parse(run(`JSON.stringify(CatalogModel.infer(${JSON.stringify(name)},CatalogModel.create().categories))`)),ids);
  }
});
test('rename, keyword edits and rescans retain manual IDs; replacements retain orphan metadata',()=>{
  const {context,run}=load();context.pattern=record();
  run("var catalog=CatalogModel.create();catalog.patterns=[pattern];catalog.categories[0].name='Pullovers';catalog.categories[0].keywords=['newword'];var next=CatalogModel.reconcile(catalog,[{path:pattern.path,name:'Sweater.pdf',size:10,lastModified:1}]);");
  assert.equal(run('next.patterns[0].id'),'pattern-1');
  assert.equal(run('next.patterns[0].categorySource'),'manual');
  assert.equal(run('next.patterns[0].categoryIds[0]'),'sweater');
  run("next=CatalogModel.reconcile(next,[{path:pattern.path,name:'Sweater.pdf',size:11,lastModified:2}]);");
  assert.equal(run('next.patterns.length'),2);assert.equal(run('next.patterns[0].present'),false);
  assert.notEqual(run('next.patterns[1].id'),'pattern-1');
});
test('used category deletion reassigns and preserves other classifications',()=>{
  const {context,run}=load();context.pattern=record('a.pdf',['sweater','hat']);
  run("var catalog=CatalogModel.create();catalog.patterns=[pattern];CatalogModel.removeCategory(catalog,'sweater','unknown');CatalogModel.validate(catalog);");
  assert.equal(run('JSON.stringify(catalog.patterns[0].categoryIds)'), '["hat"]');
  assert.throws(()=>run("CatalogModel.removeCategory(catalog,'unknown','hat')"),/cannot be deleted/);
});
test('invalid versions, category references, duplicate live paths and traversal are rejected',()=>{
  for(const mutation of ["catalog.version=2","catalog.categories[1].name='Sweater'","catalog.patterns[0].categoryIds=['missing']","catalog.patterns[0].path='../a.pdf'","catalog.patterns.push({...catalog.patterns[0],id:'another'})"]){
    const {context,run}=load();context.pattern=record();run('var catalog=CatalogModel.create();catalog.patterns=[pattern];');
    run(mutation);assert.throws(()=>run('CatalogModel.validate(catalog)'),/metadata format/);
  }
});

function directory(initial={}){
  const files=new Map(Object.entries(initial).map(([name,data])=>[name,{data,size:data.length,lastModified:1}]));
  const dir={files,failWrite:false,failRemove:false,
    async isSameEntry(other){return dir===other;},
    async getFileHandle(name,options={}){
      if(!files.has(name)){if(!options.create)throw Object.assign(new Error('Missing'),{name:'NotFoundError'});files.set(name,{data:'',size:0,lastModified:1});}
      return {async getFile(){const f=files.get(name);return {...f,async text(){return f.data;},async arrayBuffer(){return new TextEncoder().encode(f.data).buffer;}};},async createWritable(){let data;return {async write(value){if(dir.failWrite)throw new Error('disk failed');data=typeof value==='string'?value:value.data;},async close(){files.set(name,{data,size:data.length,lastModified:2});},async abort(){}};}};
    },
    async removeEntry(name){if(dir.failRemove)throw new Error('remove failed');files.delete(name);}
  };return dir;
}
function setupIO(){
  const state=load(),root=directory(),source=directory({'a.pdf':'1234567890'}),target=directory();
  Object.assign(state.context,{root,source,target,downloadDirectoryHandle:source,libraryDirectoryHandle:root,downloadFiles:[{name:'a.pdf',patternFileName:'a.pdf',patternId:'incoming-id',categoryIds:['hat','scarf'],categorySource:'manual'}],assertCheckedFile:handle=>handle.getFile()});
  state.run('libraryCatalog=CatalogModel.create();catalogRoot=root;catalogDiskText=null;');
  state.context.plan={sourceDirectory:source,sourceName:'a.pdf',sourcePath:'a.pdf',targetDirectory:target,targetFolderName:'Designer',targetName:'a.pdf'};
  return {...state,root,source,target};
}
test('successful move persists manual classification before removing original',async()=>{
  const {run,source,target,root}=setupIO();await run('copyFileThenRemoveOriginal(plan)');
  assert.equal(source.files.size,0);assert.equal(target.files.size,1);
  const p=JSON.parse(root.files.get('!pdf-organizer-library.json').data).patterns[0];
  assert.equal(p.id,'incoming-id');assert.deepEqual(p.categoryIds,['hat','scarf']);assert.equal(p.path,'Designer/a.pdf');
  assert.equal(p.sha256,require('node:crypto').createHash('sha256').update('1234567890').digest('hex'));
});
test('metadata write failure leaves original and removes newly copied PDF',async()=>{
  const {run,source,target,root}=setupIO();root.failWrite=true;
  await assert.rejects(run('copyFileThenRemoveOriginal(plan)'),/disk failed/);
  assert.equal(source.files.size,1);assert.equal(target.files.size,0);assert.equal(run('libraryCatalog.patterns.length'),0);
});
test('source removal failure keeps both PDFs and durable target classification',async()=>{
  const {run,source,target,root}=setupIO();source.failRemove=true;
  await assert.rejects(run('copyFileThenRemoveOriginal(plan)'),/remove failed/);
  assert.equal(source.files.size,1);assert.equal(target.files.size,1);assert.equal(JSON.parse(root.files.get('!pdf-organizer-library.json').data).patterns[0].id,'incoming-id');
});
test('Singles promotion keeps stable pattern ID and manual categories',async()=>{
  const {context,run,root}=setupIO();const singles=directory({'Designer_a.pdf':'1234567890'});context.singles=singles;context.pattern=record('!zz_Singles/Designer_a.pdf',['hat','scarf']);
  run("libraryCatalog.patterns=[pattern];plan.sourceDirectory=singles;plan.sourceName='Designer_a.pdf';plan.sourcePath=pattern.path;");
  await run('copyFileThenRemoveOriginal(plan)');
  const p=JSON.parse(root.files.get('!pdf-organizer-library.json').data).patterns[0];assert.equal(p.id,'pattern-1');assert.deepEqual(p.categoryIds,['hat','scarf']);assert.equal(p.path,'Designer/a.pdf');
});
test('disk conflict prevents overwrite; backup contains previous valid revision',async()=>{
  const {run,root}=setupIO();await run('persistCatalog(structuredClone(libraryCatalog))');
  const original=root.files.get('!pdf-organizer-library.json').data;
  await run('persistCatalog(structuredClone(libraryCatalog))');assert.equal(root.files.get('!pdf-organizer-library.backup.json').data,original);
  root.files.get('!pdf-organizer-library.json').data='external edit';
  await assert.rejects(run('persistCatalog(structuredClone(libraryCatalog))'),/changed/);assert.equal(root.files.get('!pdf-organizer-library.json').data,'external edit');
});

test('unsupported JSON stays untouched and blocks metadata access',async()=>{
  const {context,run,root}=setupIO();root.files.set('!pdf-organizer-library.json',{data:'{"version":99}',size:14,lastModified:1});
  context.renderCatalogUI=()=>{};
  await run('loadLibraryCatalog()');
  assert.equal(root.files.get('!pdf-organizer-library.json').data,'{"version":99}');
  assert.equal(run('libraryCatalog'),null);assert.match(run('catalogError'),/will not be overwritten/);
});

test('download/library overlap is refused in both directions',async()=>{
  const {context,run}=load();vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/storage.js'),'utf8'),context);
  context.a={isSameEntry:async other=>context.a===other,resolve:async other=>other===context.b?['nested']:[]};
  context.b={isSameEntry:async other=>context.b===other,resolve:async()=>null};
  await assert.rejects(run('assertSeparateFolders(a,a)'),/separate locations/);
  await assert.rejects(run('assertSeparateFolders(a,b)'),/separate locations/);
  await assert.rejects(run('assertSeparateFolders(b,a)'),/separate locations/);
  context.c={isSameEntry:async()=>false,resolve:async()=>null};await run('assertSeparateFolders(b,c)');
});
