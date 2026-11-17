// This is an invalidation nonce, never authorization or a reward decision.
const crypto=require('node:crypto');
const FEED_VERSION_PATH='ops_feed_versions/global';
// Each delivery gets a fresh nonce: an old/retried event must never restore a
// previously cached version and accidentally hide a newer announcement.
const bumpFeedVersion=db=>db.doc(FEED_VERSION_PATH).set({revision:crypto.randomUUID()});
module.exports={FEED_VERSION_PATH,bumpFeedVersion};
