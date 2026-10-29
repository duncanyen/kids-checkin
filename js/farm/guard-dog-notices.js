import { doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase-config.js';

// Read channel permissions before any transaction write. The same attempt ID
// is reused on Firestore retries, so one interception produces one notification.
export async function prepareGuardDogNotice(transaction, { groupId, accountId, ownerName, thiefName, breedName, blockMs, id, now }) {
    const settings = await transaction.get(doc(db, 'groups', groupId, 'settings', 'gameConfig'));
    const roomId = settings.data()?.targetRoomId;
    const roomRef = typeof roomId === 'string' && roomId && !roomId.includes('/') ? doc(db, 'rooms', roomId) : null;
    const room = roomRef ? await transaction.get(roomRef) : null;
    const channelReady = room?.exists() && room.data().groupId === groupId;
    const text = `${ownerName}的${breedName}成功攔截${thiefName}偷蛋，保護了雞蛋！對方 ${blockMs / 3600000} 小時內無法再偷這座雞舍。`;
    return () => {
        transaction.set(doc(db, 'groups', groupId, 'users', accountId, 'farm_notifications', `guard-${id}`), {
            type: 'system', title: '護衛犬成功保護雞蛋', body: text, createdAt: now, readAt: null,
        });
        if (!channelReady) return;
        transaction.set(doc(db, 'messages', `guard-${id}`), { groupId, roomId, sender: '村落廣播', text, timestamp: serverTimestamp(), isSystem: true,
            time: new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' }).format(new Date(now)) });
        transaction.update(roomRef, { lastMessage: `村落廣播: ${text}`, lastMessageTime: serverTimestamp() });
    };
}
