// Announcements are read through authenticated, audience-filtered backend APIs.
export const GAME_ANNOUNCEMENTS_ENABLED = true;
// Rewards remain disabled until player App Check is configured and verified.
export const GAME_REDEMPTION_ENABLED = false;
export const ANNOUNCEMENTS_APP_CHECK_REQUIRED = false;
export const GAME_OPERATIONS_ENABLED = GAME_ANNOUNCEMENTS_ENABLED || GAME_REDEMPTION_ENABLED;
export const OPERATIONS_APP_CHECK_SITE_KEY = '';
