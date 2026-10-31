import { db } from './firebase-config.js';
import { collection, doc, getDocs, onSnapshot, query, where, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { loadGameGroupMembers } from './game-members.js';
import { watchRooms } from './live-reads.js';
import { profileNames, roomHasMember, roomIdentity, roomIdentityPatch, creatorId, unreadFor } from './chat-identity-core.js';

export const loadChatProfiles = (groupId, accountId) => loadGameGroupMembers(groupId, accountId, {includeDocumentIds:true});
const isAdmin = user => ['admin', 'parent'].includes(user?.role);

// Both old-name and account-ID indexes are read during the transition. Never
// treat a legacy name match as membership once participantIds exists.
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
                // The canonical result overrides older snapshots from legacy queries.
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

export async function mutateRoomIdentity(context, roomId, {add = [], remove = [], bindings = null, readAt = null, activity = null} = {}) {
    const profiles = context.profiles || await loadChatProfiles(context.groupId,context.accountId);
    return runTransaction(db,async transaction=>{
        const ref=doc(db,'rooms',roomId);
        const [groupSnap,roomSnap]=await Promise.all([transaction.get(doc(db,'groups',context.groupId)),transaction.get(ref)]);
        const group=groupSnap.exists()?groupSnap.data():null, room=roomSnap.exists()?roomSnap.data():null;
        // Canonical messages need only the actor's current profile, not a fresh
        // read of every group member. Migration reads all profiles once.
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
