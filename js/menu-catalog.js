export const FOOD_MENU = Object.freeze({ id: 'food', label: '🍽️ 吃什麼？', isDefault: true, group: 'all', order: 9 });
export const DEFAULT_MENUS = [
    { id: 'chat', label: '💬 聊天室', isDefault: true, group: 'all', order: 1 },
    { id: 'calendar', label: '📅 行事曆', isDefault: true, group: 'all', order: 2 },
    { id: 'finance', label: '💰 記帳本', isDefault: true, group: 'all', order: 3 },
    { id: 'todo', label: '📝 待辦事項', isDefault: true, group: 'all', order: 4 },
    { id: 'photodump', label: '📸 Photo Dump', isDefault: true, group: 'all', order: 5 },
    { id: 'gamezone', label: '🎮 遊戲區', isDefault: true, group: 'all', order: 6 },
    { id: 'checkin', label: '📍 到家打卡', isDefault: false, group: 'family', order: 7 },
    { id: 'wishlist', label: '⭐ 許願牆', isDefault: false, group: 'family', order: 8 },
    FOOD_MENU,
];
export const MODULE_META = Object.fromEntries(DEFAULT_MENUS.map(menu => [menu.id, { name: menu.label }]));
