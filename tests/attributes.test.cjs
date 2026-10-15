const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const crypto=require('node:crypto').webcrypto;
function load(){
  const context=vm.createContext({crypto,structuredClone});
  for(const file of ['catalog-model.js','gallery-model.js','maintenance-model.js','batch.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  const run=code=>vm.runInContext(code,context);run('var catalog=CatalogModel.create();');
  return {context,run,json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}
const record=(id,categoryIds=['cardigan'])=>({id,path:`Designer/${id}.pdf`,size:100,lastModified:1,present:true,categoryIds,categorySource:'filename',representativePage:2,sha256:'a'.repeat(64)});

test('legacy catalogs and v1/v2 reviews remain readable without changing existing classifications',()=>{
  const {context,run,json}=load();context.pattern=record('legacy');context.BATCH_LIMIT=100;
  run('catalog.patterns=[pattern];var original=JSON.stringify(catalog);CatalogModel.validate(catalog);');
  assert.equal(run('JSON.stringify(catalog)===original'),true);
  assert.deepEqual(json('CatalogModel.attributeIds(catalog.patterns[0].attributeIds)'),[]);
  for(const version of [1,2]){
    context.draft={version,files:[{name:'a.pdf',role:'current',categoryIds:['cardigan'],attributeIds:['stockinette','stranded']}]};
    assert.deepEqual(json('normalizeReviewDraft(draft).files[0].attributeIds'),['stockinette','stranded']);
    assert.deepEqual(json('normalizeReviewDraft(draft).files[0].categoryIds'),['cardigan']);
  }
  assert.deepEqual(json('CatalogModel.attributes'),['stockinette','stranded','texture']);
});

test('catalogs and saved reviews reject unknown, duplicate and malformed attributes',()=>{
  const {context,run}=load();context.pattern=record('pattern');context.BATCH_LIMIT=100;run('catalog.patterns=[pattern];');
  for(const invalid of [['invalid'],['texture','texture'],'texture',null]){
    context.invalid=invalid;
    assert.throws(()=>run('catalog.patterns[0].attributeIds=invalid;CatalogModel.validate(catalog);'),/metadata format/);
    assert.throws(()=>run('normalizeReviewDraft({version:2,files:[{name:"a.pdf",role:"current",attributeIds:invalid}]})'),/attributes/);
  }
});

test('attribute replacement and explicit clearing preserve categories, source and all other pattern metadata',()=>{
  const {context,run,json}=load();context.records=[record('target'),{...record('other',['socks']),attributeIds:['stranded']}];
  run('catalog.patterns=records;var next=CatalogModel.replaceAttributes(catalog,["target"],["texture","stockinette"]);');
  assert.deepEqual(json('next.patterns[0]'),{...context.records[0],attributeIds:['stockinette','texture']});
  assert.deepEqual(json('next.patterns[1]'),context.records[1]);
  assert.deepEqual(json('catalog.patterns'),context.records);
  run('var cleared=CatalogModel.replaceAttributes(next,["target"],[]);var categories=CatalogModel.replaceCategories(next,["target"],["shawl"]);');
  assert.deepEqual(json('cleared.patterns[0].attributeIds'),[]);
  assert.deepEqual(json('categories.patterns[0].attributeIds'),['stockinette','texture']);
  assert.throws(()=>run('CatalogModel.replaceAttributes(catalog,["missing"],["texture"])'),/changed/);
  assert.throws(()=>run('CatalogModel.replaceAttributes(catalog,["target"],["invalid"])'),/attributes/);
});

test('Cardigan AND texture and multiple attributes intersect designer and full-collection search',()=>{
  const {context,run,json}=load();context.records=[{...record('both'),attributeIds:['stockinette','texture']},{...record('texture'),attributeIds:['texture']},{...record('socks',['socks']),attributeIds:['texture']},record('empty'),{...record('missing'),attributeIds:['texture'],present:false}];
  run('catalog.patterns=records;');
  const ids=options=>json(`GalleryModel.select(catalog,${JSON.stringify(options)}).map(p=>p.id)`);
  assert.deepEqual(ids({category:'cardigan',attributes:['texture']}),['both','texture']);
  assert.deepEqual(ids({category:'cardigan',attributes:['stockinette','texture'],designerName:'Designer'}),['both']);
  assert.deepEqual(ids({query:'texture',category:'cardigan'}),['both','texture']);
  assert.deepEqual(ids({attributes:['stranded']}),[]);
  assert.equal(ids({attributes:[]}).length,4);
});

test('rescan and text analysis preserve selected attributes; new files start empty',()=>{
  const {context,run,json}=load();context.pattern={...record('pattern',['unknown']),attributeIds:['texture']};
  run('catalog.patterns=[pattern];var next=CatalogModel.reconcile(catalog,[{path:pattern.path,name:"Sweater.pdf",size:100,lastModified:1},{path:"New.pdf",name:"Stranded_Sweater.pdf",size:1,lastModified:1}]);var analyzed=MaintenanceModel.applyAnalysis(pattern,{sha256:"b".repeat(64),pages:[{lines:[{text:"Sweater",height:30,y:500}]}]},catalog.categories);');
  assert.deepEqual(json('next.patterns[0].attributeIds'),['texture']);
  assert.deepEqual(json('next.patterns[1].attributeIds'),[]);
  assert.deepEqual(json('analyzed.attributeIds'),['texture']);
  assert.deepEqual(json('analyzed.categoryIds'),['sweater']);
});

test('relink retains old attributes and rejects a candidate with its own manual attributes',()=>{
  const {context,run,json}=load();context.records=[{...record('old'),present:false,attributeIds:['texture']},{...record('new',['unknown']),sha256:undefined}];
  run('catalog.patterns=records;var linked=MaintenanceModel.relink(catalog,"old","new","a".repeat(64),true);');
  assert.deepEqual(json('linked.patterns[0].attributeIds'),['texture']);
  run('catalog.patterns[1].attributeIds=["stranded"];');
  assert.throws(()=>run('MaintenanceModel.relink(catalog,"old","new","a".repeat(64),true)'),/attributes/);
});
