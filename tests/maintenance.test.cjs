const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const crypto=require('node:crypto').webcrypto;
function load(){
  const context=vm.createContext({crypto,structuredClone,console});
  for(const file of ['catalog-model.js','maintenance-model.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  const run=code=>vm.runInContext(code,context);run('var catalog=CatalogModel.create();');return {context,run,json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}
const record=(id,path,present=true)=>({id,path,present,size:100,lastModified:1,categoryIds:['unknown'],categorySource:'filename',representativePage:1});
const page=(text,height=30)=>({lines:[{text,height,y:500}]});
test('PDF headings support multiple categories, Korean and literal words while instructions stay weak',()=>{
  const {context,json}=load();
  for(const [text,want] of [['Hat and Scarf',['scarf','hat']],['스웨터',['sweater']],['that hatfield',[]],['Needles for a hat',[]],['Cast on for the sweater',[]]]){
    context.pages=[page(text)];assert.deepEqual(json('MaintenanceModel.inferText(pages,catalog.categories)').sort(),want.sort());
  }
  context.pages=[{lines:[{text:'MIDNIGHT',height:30},{text:'Wear this sweater with a hat and gloves.',height:12}]}];assert.deepEqual(json('MaintenanceModel.inferText(pages,catalog.categories)'),[]);
});
test('first-page title and explicit later type label count; incidental later heading does not',()=>{
  const {context,json}=load();context.pages=[page('MIDNIGHT'),page('Hat'),page('Pattern type: Cowl')];
  // An exact category label is evidence on a later page, unlike a generic heading sentence.
  assert.deepEqual(json('MaintenanceModel.inferText(pages,catalog.categories)').sort(),['cowl','hat']);
  context.pages=[page('MIDNIGHT'),page('Knitting with a hat')];assert.deepEqual(json('MaintenanceModel.inferText(pages,catalog.categories)'),[]);
});
test('manual Unknown and multiple manual categories survive text analysis; hash still saved',()=>{
  const {context,json}=load();context.result={pages:[page('Summer Hat')],sha256:'a'.repeat(64)};
  for(const ids of [['unknown'],['cardigan','hat']]){
    context.pattern={...record('id','Manual.pdf'),categorySource:'manual',categoryIds:ids};
    const result=json('MaintenanceModel.applyAnalysis(pattern,result,catalog.categories)');assert.deepEqual(result.categoryIds,ids);assert.equal(result.categorySource,'manual');assert.equal(result.sha256,'a'.repeat(64));
  }
});
test('unknown becomes PDF classification; conflicting filename classification is retained with suggestion',()=>{
  const {context,json}=load();context.pattern=record('id','Mystery.pdf');context.result={pages:[page('Winter Sweater')],sha256:'b'.repeat(64)};
  assert.equal(json('MaintenanceModel.applyAnalysis(pattern,result,catalog.categories)').categorySource,'pdf-text');
  context.pattern.categoryIds=['shawl'];const conflict=json('MaintenanceModel.applyAnalysis(pattern,result,catalog.categories)');assert.deepEqual(conflict.categoryIds,['shawl']);assert.equal(conflict.analysis.status,'uncertain');assert.deepEqual(conflict.analysis.matches,['sweater']);
});
test('image-only and vague PDFs retain categories and record different analysis outcomes',()=>{
  const {context,json}=load();context.pattern=record('id','Blank.pdf');
  context.result={pages:[{lines:[]}],sha256:'b'.repeat(64)};assert.equal(json('MaintenanceModel.applyAnalysis(pattern,result,catalog.categories)').analysis.status,'no-text');
  context.result.pages=[page('MIDNIGHT')];assert.equal(json('MaintenanceModel.applyAnalysis(pattern,result,catalog.categories)').analysis.status,'uncertain');
});
test('repair only offers same-size present files and never assumes a unique match',()=>{
  const {context,run,json}=load();context.records=[record('old','Old.pdf',false),record('a','Moved.pdf'),record('b','Copy.pdf'),{...record('c','Different.pdf'),size:101}];run('catalog.patterns=records');
  assert.deepEqual(json('MaintenanceModel.candidates(catalog,records[0]).map(p=>p.id)'),['a','b']);
});
test('verified relink preserves identity, manual categories and representative page across rescan',()=>{
  const {context,run,json}=load();context.records=[{...record('old','Old.pdf',false),sha256:'a'.repeat(64),categorySource:'manual',categoryIds:['hat','scarf'],representativePage:2},record('new','Moved.pdf')];run('catalog.patterns=records;var next=MaintenanceModel.relink(catalog,"old","new","a".repeat(64),true);CatalogModel.validate(next);');
  const old=json('next.patterns[0]');assert.equal(old.id,'old');assert.equal(old.path,'Moved.pdf');assert.deepEqual(old.categoryIds,['hat','scarf']);assert.equal(old.representativePage,2);assert.equal(old.present,true);assert.equal(run('next.patterns[1].mergedInto'),'old');
  run('next=CatalogModel.reconcile(next,[{path:"Moved.pdf",name:"Moved.pdf",size:100,lastModified:1}]);CatalogModel.validate(next);');assert.equal(run('next.patterns.find(p=>p.present).id'),'old');assert.equal(run('next.patterns.filter(p=>p.present).length'),1);
});
test('mismatching hashes, manual candidate and stale missing state cannot be linked',()=>{
  const {context,run}=load();context.records=[{...record('old','Old.pdf',false),sha256:'a'.repeat(64)},record('new','Moved.pdf')];run('catalog.patterns=records');
  assert.throws(()=>run('MaintenanceModel.relink(catalog,"old","new","b".repeat(64),true)'),/hash/);
  run('catalog.patterns[1].categorySource="manual"');assert.throws(()=>run('MaintenanceModel.relink(catalog,"old","new","a".repeat(64),true)'),/manual categories/);
  run('catalog.patterns[0].present=true');assert.throws(()=>run('MaintenanceModel.relink(catalog,"old","new","a".repeat(64),true)'),/changed/);
});
test('legacy explicit link stores a baseline hash without manufacturing old-content proof',()=>{
  const {context,run}=load();context.records=[record('old','Old.pdf',false),record('new','Moved.pdf')];run('catalog.patterns=records;var next=MaintenanceModel.relink(catalog,"old","new","c".repeat(64),false);CatalogModel.validate(next)');assert.equal(run('next.patterns[0].sha256'),'c'.repeat(64));assert.equal(run('catalog.patterns[0].present'),false);
});
test('restoring unchanged old path recovers its stable ID; replacement still gets a new ID',()=>{
  const {context,run}=load();context.old=record('old','Old.pdf',false);run('catalog.patterns=[old];var next=CatalogModel.reconcile(catalog,[{path:"Old.pdf",name:"Old.pdf",size:100,lastModified:1}])');assert.equal(run('next.patterns.find(p=>p.present).id'),'old');
  run('next=CatalogModel.reconcile(catalog,[{path:"Old.pdf",name:"Old.pdf",size:101,lastModified:1}])');assert.notEqual(run('next.patterns.find(p=>p.present).id'),'old');
});
test('additive JSON fields validate and category deletion also cleans analysis references',()=>{
  const {context,run}=load();context.pattern={...record('id','Text.pdf'),categorySource:'pdf-text',sha256:'d'.repeat(64),analysis:{version:1,status:'done',pages:3,matches:['hat'],at:'2026-10-15'}};run('catalog.patterns=[pattern];CatalogModel.validate(catalog);CatalogModel.removeCategory(catalog,"hat","unknown");CatalogModel.validate(catalog)');assert.equal(run('catalog.patterns[0].analysis.matches.length'),0);
  run('catalog.patterns[0].sha256="invalid"');assert.throws(()=>run('CatalogModel.validate(catalog)'),/metadata format/);
});
