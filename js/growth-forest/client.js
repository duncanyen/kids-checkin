import {GROWTH_TRANSPORT} from './transport.js';
/**
 * 依 GROWTH_TRANSPORT 載入目前的資料客戶端，避免初始化兩種登入路徑。
 * @param {{groupId: string, accountId: string}} context - 頁面識別上下文。
 * @returns {Promise<Object>} 含 api、subscribe 與照片操作的客戶端。
 * @description 目前設定為 firestore；cloud 路徑存在不代表已部署或啟用。
 */
export async function connect(context){
 const client=GROWTH_TRANSPORT==='firestore'?await import('./direct-client.js'):await import('./cloud-client.js');
 return client.connect(context);
}
