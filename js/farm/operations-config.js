// Announcements are read through authenticated, audience-filtered backend APIs.
export const GAME_ANNOUNCEMENTS_ENABLED = true;
// Redemption uses authenticated backend transactions; website attestation is optional.
export const GAME_REDEMPTION_ENABLED = true;
export const ANNOUNCEMENTS_APP_CHECK_REQUIRED = false;
export const REDEMPTION_APP_CHECK_REQUIRED = false;
export const GAME_OPERATIONS_ENABLED = GAME_ANNOUNCEMENTS_ENABLED || GAME_REDEMPTION_ENABLED;
export const OPERATIONS_APP_CHECK_SITE_KEY = '6LdkMBYuAAAAABLtMhq-EOCwYxNvY2xST93JuS5p';
