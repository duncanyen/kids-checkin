// Timestamp differences survive background throttling and full page navigation.
export class ReadingClock{
 constructor(storage,key,now=Date.now){this.storage=storage;this.key=key;this.now=now;try{this.state=JSON.parse(storage.getItem(key))||{};}catch{this.state={};}if(!Number.isFinite(this.state.elapsed)||this.state.elapsed<0)this.state.elapsed=0;if(!Number.isFinite(this.state.startedAt))this.state.startedAt=null;}
 elapsed(){return Math.max(0,this.state.elapsed+(this.state.startedAt==null?0:this.now()-this.state.startedAt));}
 save(){this.storage.setItem(this.key,JSON.stringify(this.state));}
 start(){if(this.state.startedAt==null){this.state.startedAt=this.now();this.save();}}
 pause(){this.state.elapsed=this.elapsed();this.state.startedAt=null;this.save();}
 finish(){const elapsed=this.elapsed();this.state={elapsed:0,startedAt:null};this.save();return Math.floor(elapsed/600)/100;}
 get running(){return this.state.startedAt!=null;}
}
