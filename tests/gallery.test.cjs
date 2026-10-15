const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/gallery-model.js'),'utf8')+'\nthis.model=GalleryModel;',context);return context.model;}
function catalog(){return {categories:[{id:'sweater',name:'Sweater'},{id:'hat',name:'Hat'},{id:'unknown',name:'Unknown'}],patterns:[
  {id:'a',path:'Alice/Sweater_2.pdf',present:true,categoryIds:['sweater','hat'],size:100,lastModified:1,representativePage:1},
  {id:'b',path:'Alice/Sweater_10.pdf',present:true,categoryIds:['sweater'],size:101,lastModified:2},
  {id:'c',path:'Root.pdf',present:true,categoryIds:['unknown'],size:102,lastModified:3},
  {id:'d',path:'!Special/Nested/Hat.pdf',present:true,categoryIds:['hat'],size:103,lastModified:4},
  {id:'e',path:'!zz_Singles/Bora_Top.pdf',present:true,categoryIds:['unknown'],size:104,lastModified:5},
  {id:'old',path:'Missing.pdf',present:false,categoryIds:['hat'],size:105,lastModified:6}
]};}
const ids=items=>Array.from(items,p=>p.id);
test('gallery searches all present root, Singles and nested PDFs; missing history stays hidden',()=>{const m=load();assert.equal(m.select(catalog()).length,5);assert.deepEqual(ids(m.select(catalog(),{query:'special nested'})),['d']);assert.deepEqual(ids(m.select(catalog(),{query:'BORA top'})),['e']);});
test('category filter includes every multiple classification and intersects designer/search',()=>{const m=load();assert.deepEqual(ids(m.select(catalog(),{category:'hat',designerName:'Alice',query:'sweater'})),['a']);assert.equal(m.select(catalog(),{category:'unknown'}).length,2);assert.equal(m.select(catalog(),{query:'sweater',category:'unknown'}).length,0);});
test('renamed labels are searchable without changing category IDs',()=>{const m=load(),c=catalog();c.categories[0].name='Pullovers';assert.deepEqual(ids(m.select(c,{query:'PULLOVERS alice'})),['a','b']);assert.equal(m.select(c,{category:'sweater'}).length,2);});
test('metadata preserves an explicit Singles designer containing underscores',()=>{const m=load();assert.equal(m.designer({path:'!zz_Singles/A_B_Top.pdf',designerName:'A_B'}),'A_B');assert.equal(m.designer({path:'!Special/Alice.pdf'}),'');assert.equal(m.designer({path:'Alice/Subfolder/a.pdf'}),'Alice');});
test('numeric name and latest-file sorts stay predictable',()=>{const m=load();assert.deepEqual(ids(m.select(catalog(),{designerName:'Alice'})),['a','b']);assert.deepEqual(ids(m.select(catalog(),{sort:'recent'})),['e','d','c','b','a']);});
test('pagination bounds DOM count and clamps old pages after filtering',()=>{const m=load(),patterns=Array.from({length:131},(_,id)=>({id}));let p=m.page(patterns,5);assert.equal(p.items.length,11);assert.equal(p.pages,6);p=m.page(patterns.slice(0,1),5);assert.equal(p.current,0);assert.equal(p.items.length,1);assert.equal(m.page([],9).pages,1);});
test('preview cache follows stable IDs and invalidates changed content/page/library',()=>{const m=load(),p=catalog().patterns[0],key=m.cacheKey('library-a',p);assert.equal(m.cacheKey('library-a',{...p,path:'New/a.pdf'}),key);for(const changed of [{size:101},{lastModified:2},{representativePage:2},{id:'other'}])assert.notEqual(m.cacheKey('library-a',{...p,...changed}),key);assert.notEqual(m.cacheKey('library-b',p),key);assert.equal(m.representative(catalog().patterns[1]),1);});
