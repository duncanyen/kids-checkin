import {battleCountdownState} from './battle-countdown-state.js';
const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
/** A single non-interactive overlay per fight. No requests, timers or rewards. */
export class BattleCountdown{
 constructor(scene,{battle,kind,durationMs,now}){
  this.scene=scene;this.now=now;this.started=now();this.deadline=Number.isFinite(battle.deadline)?battle.deadline:this.started+durationMs;
  this.durationMs=Math.max(1,this.deadline-(Number.isFinite(battle.startedAt)?battle.startedAt:this.deadline-durationMs));
  const parent=scene.game.canvas.parentElement;this.root=node('div','farm-battle-countdown');this.root.dataset.battleId=battle.id;this.root.dataset.monster=kind;
  this.vignette=node('div','farm-battle-vignette');this.vignette.setAttribute('aria-hidden','true');
  this.card=node('div','farm-battle-clock');this.card.setAttribute('role','timer');this.card.setAttribute('aria-live','off');
  this.label=node('span','farm-battle-clock-label');this.digits=node('strong','farm-battle-seconds');this.unit=node('span','farm-battle-clock-unit','秒');
  this.card.append(this.label,this.digits,this.unit);
  this.announcement=node('span','farm-battle-sr');this.announcement.setAttribute('role','status');this.root.append(this.vignette,this.card,this.announcement);parent.append(this.root);
  this.position=()=>{const bounds=parent.getBoundingClientRect(),top=parent.querySelector('.farm-hud-status'),rect=top?.getBoundingClientRect();this.root.style.setProperty('--battle-clock-top',`${Math.max(12,rect&&rect.height>0&&!top.hidden?rect.bottom-bounds.top+8:12)}px`);};
  this.resize=new ResizeObserver(this.position);this.resize.observe(parent);const top=parent.querySelector('.farm-hud-status');if(top)this.resize.observe(top);
  this.visibility=()=>this.tick(true);document.addEventListener('visibilitychange',this.visibility);
  this.position();this.tick(true);
 }
 tick(force=false){
  if(this.destroyed)return;const tick=performance.now();if(!force&&tick-this.lastUpdate<100)return;this.lastUpdate=tick;const wall=this.now();
  const state=battleCountdownState(this,wall),phase=this.finished?'confirming':state.phase,changed=this.phase!==phase;
  if(changed)this.root.dataset.phase=phase;
  const confirming=this.finished||state.seconds===0;
  this.root.hidden=!confirming&&!state.visible;
  const label=this.failed?'結果尚未確認':confirming?(wall>=this.deadline&&wall-this.deadline<1000?'時間到':'確認戰鬥結果…'):'',digits=confirming?'':String(state.seconds);
  if(this.label.textContent!==label)this.label.textContent=label;
  if(this.digits.textContent!==digits)this.digits.textContent=digits;
  this.unit.hidden=confirming;
  const accessible=confirming?label:`剩餘 ${state.seconds} 秒`;if(this.card.getAttribute('aria-label')!==accessible)this.card.setAttribute('aria-label',accessible);
  if(changed&&['urgent','danger','final','expired','confirming'].includes(phase))this.announcement.textContent=confirming?label:`戰鬥剩餘 ${state.seconds} 秒`;
  this.phase=phase;
 }
 stop(){this.finished=true;this.tick(true);}
 unconfirmed(){if(this.destroyed)return;this.failed=true;this.stop();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.resize.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.root.remove();}
}
