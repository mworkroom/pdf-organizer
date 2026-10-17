const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const crypto=require('node:crypto').webcrypto;
function load(){
  const context=vm.createContext({crypto,structuredClone,BATCH_LIMIT:100});
  for(const file of ['catalog-model.js','gallery-model.js','batch.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file),'utf8'),context);
  const run=code=>vm.runInContext(code,context);run('var catalog=CatalogModel.create();');return {context,run,json:code=>JSON.parse(run(`JSON.stringify(${code})`))};
}
const record=(id,attributes)=>({id,path:`Designer/${id}.pdf`,size:10,lastModified:1,present:true,categoryIds:['cardigan'],categorySource:'manual',...(attributes===undefined?{}:{attributeIds:attributes})});
test('legacy attribute catalogs stay unchanged and custom definitions validate without losing stable assignments',()=>{
  const {context,run,json}=load();context.records=[record('old',['texture']),record('empty')];run('delete catalog.attributes;catalog.patterns=records;var original=JSON.stringify(catalog);CatalogModel.validate(catalog);');
  assert.equal(run('JSON.stringify(catalog)===original'),true);
  run('catalog.attributes=structuredClone(CatalogModel.attributeDefinitions(catalog));catalog.attributes.push({id:"custom",name:"Intarsia"});catalog.patterns[0].attributeIds.push("custom");CatalogModel.validate(catalog);catalog.attributes.reverse();catalog.attributes[0].name="Colorwork";CatalogModel.validate(catalog);');
  assert.deepEqual(json('catalog.patterns[0].attributeIds'),['texture','custom']);
  assert.equal(run('GalleryModel.select(catalog,{query:"colorwork"})[0].id'),'old');
  assert.deepEqual(json('GalleryModel.select(catalog,{attributes:["custom"]}).map(p=>p.id)'),['old']);
});
test('attribute dictionaries reject duplicate labels and IDs, missing references and invalid snapshots',()=>{
  const {context,run}=load();context.records=[record('a',['texture'])];run('catalog.patterns=records;');
  for(const definitions of [null,[{id:'a',name:'Intarsia'},{id:'b',name:' intarsia '}],[{id:'a',name:'A'},{id:'a',name:'B'}],[{id:'a',name:''}]]){
    context.definitions=definitions;assert.throws(()=>run('CatalogModel.validate({...catalog,attributes:definitions})'),/metadata format/);
    assert.throws(()=>run('normalizeReviewDraft({version:2,attributes:definitions,files:[]})'),/attribute|Attribute/);
  }
  assert.throws(()=>run('CatalogModel.validate({...catalog,attributes:[]})'),/metadata format/);
  assert.throws(()=>run('normalizeReviewDraft({version:2,attributes:[{id:"custom",name:"Intarsia"}],files:[{name:"a.pdf",role:"current",attributeIds:["missing"]}]})'),/attributes/);
});
test('custom review snapshots recover in small batches and deletion can merge or clear assignments independently of categories',()=>{
  const {context,run,json}=load();context.records=[record('a',['custom','texture']),{...record('missing',['custom']),present:false},record('other',['stranded'])];
  run('catalog.attributes.push({id:"custom",name:"Intarsia"});catalog.patterns=records;var restored=normalizeReviewDraft({version:2,attributes:catalog.attributes,files:[{name:"a.pdf",role:"current",attributeIds:["custom"]}]});var next=CatalogModel.removeAttribute(structuredClone(catalog),"custom","texture");');
  assert.deepEqual(json('restored.files[0].attributeIds'),['custom']);assert.deepEqual(json('next.patterns[0]'),{...context.records[0],attributeIds:['texture']});assert.deepEqual(json('next.patterns[1].attributeIds'),['texture']);assert.deepEqual(json('next.patterns[2]'),context.records[2]);
  run('CatalogModel.removeAttribute(next,"texture");');assert.deepEqual(json('next.patterns[0].attributeIds'),[]);assert.deepEqual(json('next.patterns[0].categoryIds'),['cardigan']);
  assert.throws(()=>run('CatalogModel.removeAttribute(catalog,"custom","missing")'),/replacement/);
});
test('None includes empty and legacy values, excludes missing files, and intersects category, designer and search',()=>{
  const {context,run,json}=load();context.records=[record('legacy'),record('empty',[]),record('assigned',['texture']),{...record('missing',[]),present:false},{...record('socks',[]),categoryIds:['socks']}];run('catalog.patterns=records;');
  assert.deepEqual(json('GalleryModel.select(catalog,{attributeMode:"none",category:"cardigan"}).map(p=>p.id)'),['empty','legacy']);
  assert.deepEqual(json('GalleryModel.select(catalog,{attributeMode:"none",category:"cardigan",designerName:"Designer",query:"legacy"}).map(p=>p.id)'),['legacy']);
  assert.equal(run('GalleryModel.select(catalog,{attributeMode:"any",attributes:["texture"]}).length'),4);
  assert.deepEqual(json('GalleryModel.select(catalog,{attributeMode:"selected",attributes:["texture"]}).map(p=>p.id)'),['assigned']);
});
