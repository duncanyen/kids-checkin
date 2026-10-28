// Compare read/subscription counts and tenant/identity constraints. A last-read
// timestamp is intentionally different between runs; normalize only that value.
const assert=require('node:assert/strict'),fs=require('node:fs');
const [beforePath='/tmp/nexus-navigation-final-baseline.json',afterPath='/tmp/nexus-navigation-final-optimized.json']=process.argv.slice(2);
const read=path=>JSON.parse(fs.readFileSync(path,'utf8')).results.filter(r=>r.label==='pair');
const key=r=>[r.network,r.cache,r.source,r.target].join('|');
const signatures=r=>r.operations.filter(o=>['getDoc','getDocs','count','subscribe'].includes(o.kind)).map(o=>{
 const value={kind:o.kind,path:o.path,filters:o.filters?.map(f=>f.field==='timestamp'?{...f,value:'<runtime-last-read>'}:f)};
 return JSON.stringify(value);
}).sort();
const before=new Map(read(beforePath).map(r=>[key(r),r]));const after=read(afterPath);
assert.equal(before.size,24);assert.equal(after.length,24);
for(const row of after)assert.deepEqual(signatures(row),signatures(before.get(key(row))),key(row));
console.log('PASS: all 24 paired cases preserve SDK read/subscription counts and query constraints (runtime last-read timestamp normalized).');
