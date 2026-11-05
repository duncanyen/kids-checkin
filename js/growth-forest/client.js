import {GROWTH_TRANSPORT} from './transport.js';
export async function connect(context){
 const client=GROWTH_TRANSPORT==='firestore'?await import('./direct-client.js'):await import('./cloud-client.js');
 return client.connect(context);
}
