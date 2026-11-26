/** Display-only timing: never extends the server deadline or settles a battle. */
export function battleCountdownState({deadline,durationMs},now){
 const remaining=Math.max(0,deadline-now),seconds=Math.ceil(remaining/1000);
 return {seconds,ratio:Math.min(1,remaining/Math.max(1,durationMs)),phase:seconds===0?'expired':seconds<=3?'final':seconds<=5?'danger':seconds<=10?'urgent':'normal'};
}
