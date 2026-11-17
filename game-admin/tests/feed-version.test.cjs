const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs'),{bumpFeedVersion,FEED_VERSION_PATH}=require('../functions/feed-version.cjs');
test('out-of-order or repeated announcement events cannot restore a cached old revision',async()=>{
 const db=new MemoryDB();await bumpFeedVersion(db,'old-event');const old=db.data.get(FEED_VERSION_PATH).revision;
 await bumpFeedVersion(db,'new-event');const next=db.data.get(FEED_VERSION_PATH).revision;
 await bumpFeedVersion(db,'old-event');const retry=db.data.get(FEED_VERSION_PATH).revision;
 assert.notEqual(retry,old);assert.notEqual(retry,next);assert.deepEqual([...db.data.keys()],[FEED_VERSION_PATH]);
});
