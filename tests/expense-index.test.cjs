const test=require('node:test'),assert=require('node:assert/strict');
const indexes=require('../firestore.indexes.json').indexes;
test('homepage group ledger has an exact ascending month-range index, without requiring amount on legacy documents',()=>{
 assert.ok(indexes.some(index=>index.collectionGroup==='expenses'&&index.queryScope==='COLLECTION'
  &&JSON.stringify(index.fields)===JSON.stringify([{fieldPath:'groupId',order:'ASCENDING'},{fieldPath:'date',order:'ASCENDING'}])));
});
test('existing descending cursor pagination indexes remain available for group and personal ledgers',()=>{
 for(const fields of [
  [{fieldPath:'groupId',order:'ASCENDING'},{fieldPath:'date',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}],
  [{fieldPath:'groupId',order:'ASCENDING'},{fieldPath:'type',order:'ASCENDING'},{fieldPath:'date',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}],
  [{fieldPath:'type',order:'ASCENDING'},{fieldPath:'date',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}]
 ])assert.ok(indexes.some(index=>index.collectionGroup==='expenses'&&index.queryScope==='COLLECTION'&&JSON.stringify(index.fields)===JSON.stringify(fields)));
});
