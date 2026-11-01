// Canonical likes use account IDs; display names remain legacy compatibility only.
export function photoLikes(photo, accountId, aliases = []) {
    const ids = new Set((Array.isArray(photo.likeAccountIds) ? photo.likeAccountIds : []).filter(value => typeof value === 'string'));
    const names = new Set(aliases.filter(Boolean));
    const legacy = new Set((Array.isArray(photo.likes) ? photo.likes : []).filter(value => typeof value === 'string'));
    const ownLegacy = [...legacy].some(name => names.has(name));
    const others = [...legacy].filter(name => !names.has(name));
    return { liked: ids.has(accountId) || ownLegacy, count: ids.size + others.length + (ownLegacy && !ids.has(accountId) ? 1 : 0), ids, others };
}
export function updatePhotoLike(photo, accountId, aliases, liked) {
    const state = photoLikes(photo, accountId, aliases);
    if (liked) state.ids.add(accountId); else state.ids.delete(accountId);
    return { likeAccountIds: [...state.ids], likes: state.others };
}
