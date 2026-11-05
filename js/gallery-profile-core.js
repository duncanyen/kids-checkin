// Stored names are historical labels; stable account IDs select live profiles.
export function photoPerson(accountId, storedName, profiles = []) {
    const available = profiles.filter(p => p.role !== 'removed');
    if (accountId) return available.find(p => p.accountId === accountId) || { accountId, name: storedName || accountId };
    const matches = available.filter(p => [p.name, ...(Array.isArray(p.nameHistory) ? p.nameHistory : [])].includes(storedName));
    return matches.length === 1 ? matches[0] : { name: storedName || '未知使用者' };
}
export const photoAvatar = (person, fallback = '') => person.avatar || person.photoURL || person.avatarUrl || fallback || '';
