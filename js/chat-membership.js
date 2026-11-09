import { db } from './firebase-config.js';
import { collection, doc, getDocs, onSnapshot, query, where, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { loadGameGroupMembers } from './game-members.js';
import { watchRooms } from './live-reads.js';
import { profileNames, roomHasMember, roomIdentity, roomIdentityPatch, creatorId, unreadFor } from './chat-identity-core.js';

export const loadChatProfiles = (groupId, accountId) => loadGameGroupMembers(groupId, accountId, {includeDocumentIds:true});
const isAdmin = user => ['admin', 'parent'].includes(user?.role);

// 過渡期間合併姓名與 accountId 索引；已有 participantIds 時，姓名命中不能重新授權。
/**
 * 訂閱目前帳號在指定群組的房間，同時相容舊姓名索引。
 * @param {string} groupId - 群組 ID。
 * @param {string} accountId - 固定帳號。
 * @param {Array<Object>} profiles - 已限定群組的成員資料與歷史姓名。
 * @param {Function} next - 接收合併並再次驗證成員資格的快照。
 * @param {Function} error - 訂閱錯誤處理。
 * @returns {Function} 解除所有實際建立的房間監聽；不可只解除其中一個來源。
 */
export function watchMemberRooms(groupId, accountId, profiles, next, error) {
    const source = query(collection(db,'rooms'),where('groupId','==',groupId),where('participantIds','array-contains',accountId));
    const fallback = (emit, fail) => {
        const aliases = profileNames(profiles.find(user => user.accountId === accountId));
        const sources = [source, ...aliases.map(name => query(collection(db,'rooms'),where('groupId','==',groupId),where('participants','array-contains',name)))];
        const snapshots = new Map();
        return (() => {
            const stops = sources.map((ref,index) => onSnapshot(ref, snapshot => {
                snapshots.set(index,snapshot);
                const documents = new Map();
                // 固定帳號查詢的結果優先於舊姓名查詢的快照。
                for(const [i,snap] of [...snapshots].sort(([a],[b])=>b-a)) snap.forEach(document=>documents.set(document.id,document));
                const docs = [...documents.values()].filter(document=>document.data().groupId===groupId&&roomHasMember(document.data(),accountId,profiles));
                docs.sort((a,b)=>(b.data().lastMessageTime?.toMillis?.()||0)-(a.data().lastMessageTime?.toMillis?.()||0));
                emit({docs,empty:!docs.length,size:docs.length,forEach:callback=>docs.forEach(callback)});
            },fail));
            return ()=>stops.forEach(stop=>stop());
        })();
    };
    return watchRooms(source,groupId,accountId,snapshot=>{
        const docs=[];snapshot.forEach(document=>{if(document.data().groupId===groupId&&roomHasMember(document.data(),accountId,profiles))docs.push(document);});
        next({docs,empty:!docs.length,size:docs.length,forEach:callback=>docs.forEach(callback)});
    },error,fallback);
}

/**
 * 在交易內重查群組、房間與必要成員，修改成員／已讀／活動摘要。
 * @param {Object} context - groupId、accountId 及可選的群組 profiles。
 * @param {string} roomId - 房間文件 ID。
 * @param {Object} [changes] - 成員增刪、舊資料綁定、已讀時間或訊息摘要。
 * @returns {Promise<Object>} 套用識別更新後的房間資料。
 * @description participantIds 已存在時不以舊姓名重新授權；修復操作限管理角色。
 */
export async function mutateRoomIdentity(context, roomId, {add = [], remove = [], bindings = null, readAt = null, activity = null} = {}) {
    const profiles = context.profiles || await loadChatProfiles(context.groupId,context.accountId);
    return runTransaction(db,async transaction=>{
        const ref=doc(db,'rooms',roomId);
        const [groupSnap,roomSnap]=await Promise.all([transaction.get(doc(db,'groups',context.groupId)),transaction.get(ref)]);
        const group=groupSnap.exists()?groupSnap.data():null, room=roomSnap.exists()?roomSnap.data():null;
        // 新格式操作只需重讀操作者及必要目標；舊資料遷移才需一次確認完整成員。
        const targets=Array.isArray(room?.participantIds)?profiles.filter(user=>user.accountId===context.accountId||add.includes(user.accountId)):profiles;
        const userSnaps=await Promise.all(targets.map(user=>transaction.get(doc(db,'users',user.docId))));
        const current=userSnaps.filter(snap=>snap.exists()).map(snap=>snap.data()).filter(user=>group?.members?.includes(user.accountId)&&user.role!=='removed');
        const actor=current.find(user=>user.accountId===context.accountId);
        if(!actor||room?.groupId!==context.groupId)throw new Error('聊天室或群組資格已變更，請重新進入。');
        const repair=bindings!==null;
        if(repair&&!isAdmin(actor))throw new Error('只有群組管理者可以確認舊聊天室成員。');
        if(!repair&&!roomHasMember(room,context.accountId,current))throw new Error('你已不在此聊天室內。');
        const patch=roomIdentityPatch(room,current,bindings||{});
        if(remove.some(id=>id!==context.accountId)&&!isAdmin(actor)&&creatorId({...room,...patch},current)!==context.accountId)throw new Error('你沒有移除成員的權限。');
        if(add.some(id=>!current.some(user=>user.accountId===id)))throw new Error('部分成員已離開目前群組。');
        patch.participantIds=[...new Set([...patch.participantIds,...add])].filter(id=>!remove.includes(id));
        if(readAt!==null){patch.readByAccount[context.accountId]=readAt;patch.unreadByAccount[context.accountId]=0;}
        if(activity){
            Object.assign(patch,{lastMessage:activity.lastMessage,lastMessageTime:activity.lastMessageTime,lastSenderAccountId:context.accountId});
            for(const id of patch.participantIds)if(id!==context.accountId)patch.unreadByAccount[id]=(unreadFor({...room,...patch},id,current)||0)+1;
        }
        if(!Array.isArray(room.participantIds)||add.length||remove.length||repair||readAt!==null||activity)transaction.update(ref,patch);
        return {...room,...patch};
    });
}

export async function legacyRoomsForAdmin(context) {
    const profiles=await loadChatProfiles(context.groupId,context.accountId);
    if(!isAdmin(profiles.find(user=>user.accountId===context.accountId)))throw new Error('只有群組管理者可以修復舊聊天室。');
    const snapshot=await getDocs(query(collection(db,'rooms'),where('groupId','==',context.groupId)));
    return {profiles,rooms:snapshot.docs.filter(document=>!Array.isArray(document.data().participantIds)).map(document=>({id:document.id,...document.data(),identity:roomIdentity(document.data(),profiles)}))};
}
