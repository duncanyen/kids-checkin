// 歷史訊息以文件游標分頁，不以日期截止。
export const MESSAGE_PAGE_SIZE = 30;
const time = message => message.timestamp?.toMillis?.() ?? message.timestamp?.toDate?.().getTime() ?? 0;
const compare = (a,b) => time(a)-time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export class ChatHistory {
    constructor(roomId, readPage) {
        this.roomId=roomId;this.readPage=readPage;this.messages=new Map();
        this.cursor=null;this.hasMore=true;this.loading=false;this.error=false;
    }
    merge(rows) {
        for(const message of rows) this.messages.set(message.id,message);
        return this.list;
    }
    get list() { return [...this.messages.values()].sort(compare); }
    /**
     * 載入較舊一頁，使用 loading 鎖避免重複讀取；失敗保留重試機會。
     * @returns {Promise<boolean>} 本次是否完成讀取；資料依 id 去重、時間排序。
     * @throws {Error} 讀取失敗時設 error 並向呼叫端傳遞。
     */
    async loadOlder() {
        if(this.loading || !this.hasMore)return false;
        this.loading=true;this.error=false;
        try {
            const page=await this.readPage(this.cursor,this.list[0]);
            this.merge(page.messages);
            this.cursor=page.cursor || this.cursor;
            this.hasMore=page.hasMore;
            return true;
        } catch(error) { this.error=true;throw error; }
        finally { this.loading=false; }
    }
}
