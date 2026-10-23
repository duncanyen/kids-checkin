import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getSelectedGameGroupId } from './game-context.js';
import { DEFAULT_SETTINGS, normalizeSettings, calculatePoints, ownerId, belongsToGroup, isAdminRole, validateSetting, canChangeRedeem } from './wishwall-core.js';
import { validDate, dateKey } from './todo-core.js';

const recordId = value => { if (typeof value !== 'string' || !value || value.includes('/')) throw new Error('無效的紀錄識別碼。'); return value; };

export class WishWallStore {
    constructor(context) {
        this.context = context;
        this.groupRef = doc(db, 'groups', context.groupId);
        this.settingsRef = doc(db, 'groups', context.groupId, 'settings', 'wishWall');
        this.revisionRef = doc(db, 'groups', context.groupId, 'settings', 'wishWallRevision');
    }
    ref(kind, id) { return doc(db, 'groups', this.context.groupId, kind, recordId(id)); }
    collection(kind) { return collection(db, 'groups', this.context.groupId, kind); }
    assertContext() {
        const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
        if (user?.accountId !== this.context.accountId || getSelectedGameGroupId(user) !== this.context.groupId) throw new Error('群組或帳號已切換，請重新開啟許願牆。');
    }
    async loadMembers() {
        this.assertContext();
        const snapshot = await getDoc(this.groupRef);
        if (!snapshot.exists()) throw new Error('群組不存在，請返回首頁重新選擇。');
        const group = snapshot.data();
        const ids = [...new Set((group.members || []).filter(id => typeof id === 'string'))];
        if (!ids.includes(this.context.accountId)) throw new Error('你已不在目前群組內，請返回首頁重新選擇。');
        const members = new Map();
        for (let offset = 0; offset < ids.length; offset += 10) {
            const batch = ids.slice(offset, offset + 10);
            const profiles = await getDocs(query(collection(db, 'users'), where('accountId', 'in', batch)));
            profiles.forEach(profile => {
                const member = profile.data();
                if (batch.includes(member.accountId) && member.role !== 'removed') members.set(member.accountId, { ...member, docId: profile.id });
            });
        }
        const own = members.get(this.context.accountId);
        if (!own) throw new Error('找不到目前帳號的個人資料，請重新登入。');
        this.profileRef = doc(db, 'users', own.docId);
        return { group, ids, members, own };
    }

    // All writers increment one group revision. Ledger-dependent operations first
    // discover document IDs, then check that revision and reread documents inside
    // the transaction. Concurrent insertions trigger an outer retry (no phantom
    // credits or double spending), without introducing a second balance ledger.
    async mutate(change, { ledger = false, admin = false, refs = [] } = {}) {
        for (let attempt = 0; attempt < 5; attempt++) {
            this.assertContext();
            let baseline = 0, scoreRefs = [], redeemRefs = [];
            if (ledger) {
                baseline = (await getDoc(this.revisionRef)).data()?.revision || 0;
                const [scores, redeems] = await Promise.all([getDocs(query(this.collection('scores'), where('accountId', '==', this.context.accountId))), getDocs(query(this.collection('redeems'), where('accountId', '==', this.context.accountId)))]);
                scoreRefs = scores.docs.map(snapshot => this.ref('scores', snapshot.id));
                redeemRefs = redeems.docs.map(snapshot => this.ref('redeems', snapshot.id));
            }
            try {
                return await runTransaction(db, async transaction => {
                    this.assertContext();
                    const [group, profile, setting, version, ...records] = await Promise.all(
                        [this.groupRef, this.profileRef, this.settingsRef, this.revisionRef, ...refs, ...scoreRefs, ...redeemRefs].map(ref => transaction.get(ref)));
                    if (!group.exists() || !(group.data().members || []).includes(this.context.accountId)) throw new Error('你已不在此群組，無法儲存。');
                    const actor = profile.data();
                    if (actor?.accountId !== this.context.accountId || actor.role === 'removed') throw new Error('目前帳號已無法使用許願牆。');
                    if (admin && !isAdminRole(actor)) throw new Error('只有管理者可修改群組設定。');
                    const revision = version.data()?.revision || 0;
                    if (ledger && revision !== baseline) { const error = new Error('資料已更新'); error.code = 'WISH_LEDGER_CHANGED'; throw error; }
                    const toRecords = snapshots => snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ ...snapshot.data(), id: snapshot.id }));
                    const result = change({ transaction, actor, group: group.data(), setting,
                        settings: normalizeSettings(setting.exists() ? setting.data() : DEFAULT_SETTINGS),
                        records: records.slice(0, refs.length),
                        scores: toRecords(records.slice(refs.length, refs.length + scoreRefs.length)),
                        redeems: toRecords(records.slice(refs.length + scoreRefs.length)),
                    });
                    if (!result?.noChange) transaction.set(this.revisionRef, { revision: revision + 1, groupId: this.context.groupId, accountId: this.context.accountId, updatedAt: serverTimestamp() }, { merge: true });
                    return result;
                });
            } catch (error) { if (error.code !== 'WISH_LEDGER_CHANGED') throw error; }
        }
        throw new Error('資料正被其他成員更新，請稍後重試。');
    }
    audit() { return { groupId: this.context.groupId, updatedByAccountId: this.context.accountId, updatedAt: serverTimestamp() }; }
    async ensureSettings() {
        return this.mutate(({ transaction, setting }) => {
            if (setting.exists()) return { noChange: true };
            transaction.set(this.settingsRef, { ...normalizeSettings(DEFAULT_SETTINGS), ...this.audit(), accountId: this.context.accountId, createdByAccountId: this.context.accountId });
        }, { admin: true });
    }
    async changeSetting(type, input, removeId) {
        if (!['examRules', 'choreRules', 'gifts'].includes(type)) throw new Error('無效的設定類型。');
        const value = removeId ? null : validateSetting(type, input);
        return this.mutate(({ transaction, settings, setting }) => {
            settings[type] = removeId ? settings[type].filter(item => item.id !== removeId) : [...settings[type], { ...value, id: crypto.randomUUID(), groupId: this.context.groupId, accountId: this.context.accountId }];
            transaction.set(this.settingsRef, { ...settings, ...this.audit(), accountId: this.context.accountId, createdByAccountId: setting.data()?.createdByAccountId || setting.data()?.accountId || this.context.accountId }, { merge: true });
        }, { admin: true });
    }
    async createScore(input) {
        if (!['exam', 'chore'].includes(input.category)) throw new Error('無效的成績類型。');
        if (input.category === 'exam' && (!validDate(input.date) || !Number.isInteger(input.score) || input.score < 0 || input.score > 100 || !input.examType || !input.subject)) throw new Error('請輸入正確日期、科目與 0–100 的分數。');
        const ref = this.ref('scores', crypto.randomUUID());
        return this.mutate(({ transaction, actor, settings }) => {
            let detail;
            if (input.category === 'chore') {
                const rule = settings.choreRules.find(rule => rule.id === input.choreId);
                if (!rule) throw new Error('家事項目已變更，請重新選擇。');
                detail = { category: 'chore', choreId: rule.id, choreName: rule.name, points: Number(rule.points), date: dateKey() };
                if (!Number.isFinite(detail.points) || detail.points < 0) throw new Error('家事積分設定無效。');
            } else detail = { category: 'exam', date: input.date, score: input.score, examType: input.examType, subject: input.subject };
            transaction.set(ref, { ...detail, ...this.audit(), accountId: this.context.accountId, createdByAccountId: this.context.accountId, operator: actor.name || this.context.accountId, timestamp: serverTimestamp() });
        });
    }
    async deleteScore(id) {
        const ref = this.ref('scores', id);
        return this.mutate(({ transaction, actor, records }) => {
            const score = records[0].data();
            if (!score || !belongsToGroup(score, this.context.groupId) || (!isAdminRole(actor) && ownerId(score) !== this.context.accountId)) throw new Error('你無法刪除這筆紀錄。');
            transaction.delete(ref);
        }, { refs: [ref] });
    }
    async redeem(giftId, detail) {
        if (!String(detail || '').trim()) throw new Error('請輸入希望兌換的詳細內容。');
        const ref = this.ref('redeems', crypto.randomUUID()), messageRef = this.ref('messages', crypto.randomUUID());
        return this.mutate(({ transaction, actor, settings, scores, redeems }) => {
            const gift = settings.gifts.find(gift => gift.id === giftId);
            if (!gift || !Number.isFinite(Number(gift.points)) || gift.points <= 0) throw new Error('獎品已變更，請重新選擇。');
            const points = calculatePoints(scores, redeems, settings, this.context.groupId).balances.get(this.context.accountId) || 0;
            if (points < Number(gift.points)) throw new Error('積分不足，無法兌換。');
            transaction.set(ref, { ...this.audit(), accountId: this.context.accountId, createdByAccountId: this.context.accountId, operator: actor.name || this.context.accountId, giftId, item: gift.name, detail: String(detail).trim(), cost: Number(gift.points), status: '申請中', date: dateKey(), timestamp: serverTimestamp() });
            transaction.set(messageRef, { ...this.audit(), accountId: this.context.accountId, sender: '許願小幫手', text: `${actor.name || this.context.accountId} 許願兌換了【${gift.name}】！`, timestamp: serverTimestamp() });
        }, { ledger: true });
    }
    async updateRedeem(id, status, reason = '') {
        const ref = this.ref('redeems', id), messageRef = this.ref('messages', crypto.randomUUID());
        return this.mutate(({ transaction, actor, records }) => {
            const record = records[0].data();
            if (!record || !ownerId(record) || !belongsToGroup(record, this.context.groupId)) throw new Error('紀錄不存在或尚未綁定帳號。');
            if (!canChangeRedeem(record, status, this.context.accountId, isAdminRole(actor))) return { noChange: true };
            if (['已取消', '已駁回'].includes(status) && !reason.trim()) throw new Error('請輸入取消或駁回的理由。');
            transaction.update(ref, { ...this.audit(), accountId: record.accountId, status, ...(reason.trim() ? { reason: reason.trim() } : {}) });
            if (['已取消', '已駁回'].includes(status)) transaction.set(messageRef, { ...this.audit(), accountId: this.context.accountId, ownerAccountId: record.accountId, sender: '系統通知', text: `兌換申請${status}：${reason.trim()}`, timestamp: serverTimestamp() });
        }, { refs: [ref] });
    }
    async bindLegacy(kind, id, accountId) {
        if (!['scores', 'redeems'].includes(kind)) throw new Error('無效的紀錄類型。');
        const ref = this.ref(kind, id);
        return this.mutate(({ transaction, group, records }) => {
            const record = records[0].data();
            if (!record || ownerId(record) || !belongsToGroup(record, this.context.groupId) || !(group.members || []).includes(accountId)) throw new Error('只能將未綁定的舊紀錄指派給目前群組成員。');
            transaction.update(ref, { ...this.audit(), accountId });
        }, { admin: true, refs: [ref] });
    }
}
