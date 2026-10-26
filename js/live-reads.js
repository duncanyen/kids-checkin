import { onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getSelectedGameGroupId } from './game-context.js';
import { REALTIME_READS_ENABLED } from './live-read-config.js';
import { liveKey, liveDocument, subscribeLive, accessDenied } from './live-read-core.js';
const connect = context => import('./live-read-platform.js').then(module => module.connect(context));
const context = () => {
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
    return { accountId: user?.accountId, groupId: getSelectedGameGroupId(user) };
};
const report = error => {
    console.warn('即時資料讀取失敗', error.code);
    window.dispatchEvent(new CustomEvent('nexus-live-error', { detail: { code: error.code } }));
    if (!document.getElementById('nexusLiveError')) {
        const banner = document.createElement('div'); banner.id = 'nexusLiveError'; banner.setAttribute('role', 'alert');
        banner.textContent = '即時資料連線無法使用，請重新登入或重新選擇群組。';
        banner.style.cssText = 'position:fixed;bottom:12px;left:5%;width:90%;box-sizing:border-box;padding:12px;background:#542723;color:#fff2cc;border-radius:8px;z-index:10000;text-align:center;font-size:14px';
        document.body.appendChild(banner);
    }
};
function watch(source, options, next, error = report) {
    return subscribeLive({ enabled: REALTIME_READS_ENABLED, connect, context: context(), ...options,
        fallback: (next, error) => onSnapshot(source, next, error), next, error: reason => { report(reason); if (error !== report) error(reason); } });
}
const farmPath = ref => {
    const parts = ref.path.split('/');
    if (parts.length !== 4 || parts[0] !== 'groups' || parts[2] !== 'users') throw Error('無效的農場路徑');
    return `farms/${liveKey(parts[1])}/${liveKey(parts[3])}`;
};
export const watchFarm = (ref, next, error) => watch(ref, { channel: 'farms', path: REALTIME_READS_ENABLED ? farmPath(ref) : '' }, next, error);
export async function readFarm(ref) {
    if (REALTIME_READS_ENABLED) try {
        const runtime = await connect(context());
        if (runtime.ready.farms) {
            const path = farmPath(ref), value = await runtime.read(path);
            if (value?.data && !value.deleted) return liveDocument(path.split('/').at(-1), value);
        }
    } catch (error) { if (accessDenied(error)) throw error; }
    return getDoc(ref);
}
export const watchRooms = (source, groupId, accountId, next, error) => watch(source, { channel: 'chat', list: true, path: `inboxes/${liveKey(groupId)}/${liveKey(accountId)}` }, next, error);
export const watchRoom = (source, groupId, roomId, next, error) => watch(source, { channel: 'chat', path: `rooms/${liveKey(groupId)}/${liveKey(roomId)}` }, next, error);
export const watchMessages = (source, groupId, roomId, limit, next, error) => watch(source, { channel: 'chat', list: true, limit, path: `messages/${liveKey(groupId)}/${liveKey(roomId)}` }, next, error);
