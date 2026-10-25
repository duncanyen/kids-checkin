# Farm scenery

The home and visiting farms use the user-supplied farm-map.jpg, copied without
image edits from the supplied 720 × 1280 artwork. The map already contains the
coop and vegetable garden. It is fitted proportionally to the 390 × 844 canvas,
cropping the outer tree margins at the sides rather than stretching the image.

Earlier AI-generated standalone art remains available for menu backgrounds and
shop/village icons. The unused standalone bed/plant assets are retained without
preloading them. WebP props retain transparency.

| File | Pixels | Use |
| --- | --- | --- |
| farm-map.jpg | 720 × 1280 | Supplied field map for home and visiting farms |
| background.webp | 780 × 1688 | Village/shop/warehouse menu background |
| coop.webp | 320 × 300 | Village and shop coop icons |
| garden-bed.webp | 660 × 660 | Retained standalone soil-bed art |
| cabbage.webp | 64 × 64 | Retained standalone cabbage art |
| signboard.webp | 88 × 100 | Help sign, drawn at 32 × 38 |
| wolf-sheet.webp | 1024 × 1024 | 4 × 4 grid, 256 × 256 per frame |
| tiger-sheet.webp | 1024 × 1024 | 4 × 4 grid, 256 × 256 per frame |
| dragon-sheet.webp | 2048 × 1024 | 8 × 4 grid, 256 × 256 per frame |
| dragon-scale.webp | 128 × 128 | Transparent dragon loot inventory/shop icon |

## Map interaction and layout

js/farm/scenery.js shares map coordinates between home and visiting farms.
The coop is a hit zone over the painted building, not a duplicate sprite.
Its Lv. badge reflects the existing upgrade/capacity logic. The baked building
and hit zone stay aligned instead of resizing. The village list still uses
standalone coop icons at 96 × 90.

The 42 painted cabbages (7 × 6) have independent hit zones aligned with their
pictured positions. Click pulses provide feedback while the existing
worm-search/reward logic stays unchanged.

Hen spawn points, wander destinations and egg-laying gathering positions all
stay in the central grass clearing between the coop-front fence and the
vegetable fence. Bounds include room for the entire hen sprite. Rubbish also
stays on that ground.

## Predators and hen navigation

Painted backgrounds use linear filtering. Hen, wolf, tiger and dragon pixel sprites
use nearest filtering to preserve their outlines.

Predator sheets have four walk frames (0–3), four run frames (4–7), four stunned
frames with golden stars (8–11), and four non-graphic defeat frames (12–15).
The final defeat pose stays visible before fading. Repeated hits restart the
hit pose without pausing travel; resolved events cannot resume or resolve twice.

Predators face northeast, mirrored for northwest. Spawn/destination coordinates
produce a matching 45-degree approach towards the pictured coop front. Wolves
take 60 seconds, tigers 50 seconds, including time spent in hit poses.
Predators render at 192 × 192. Their lossless sheets are exported from the
full-resolution originals, not enlarged from previous 64-pixel frames.

js/farm/hen-navigation.js plans full paths around visible predators with room
for the hen's body. Visiting farms recheck every 200 ms and when an event starts.
Hens retreat if needed, including sick hens whose status icons follow them.
Defeated animals remain obstacles until they fade. Normal wandering resumes
when the scene clears; these movements never write remote farm records.

## Fire dragon

The dragon sheet is an AI-assisted cleanup/adaptation of the supplied red dragon
reference. Labels and the checkerboard were removed, with eight aligned frames
per row: right-facing flight (0–7), fire breathing (8–15), hurt (16–23), and defeat
(24–31). It renders at 176 × 176 so its wings fit beside the painted coop. The
scale icon is newly generated pixel art. Both assets are lossless WebP with alpha.

At home, a valid egg-collection attempt at coop level 2+ has a 1/20 dragon chance.
An encounter delays collection until victory and settlement; the next collection
after victory bypasses the roll. Home defeat burns only the player’s own eggs
and deducts their coins. Home hens also avoid the dragon.

A visit rolls once after the target farm snapshot arrives. Only a visited coop
at level 2+ can roll the 1/30 dragon encounter; otherwise the old tiger/wolf rolls
apply. The first 10 seconds fly from bottom-left to the coop's left side, followed
by 30 seconds breathing right. Hits never reset the scene-clock timers. Health is
600, and damage comes from WEAPONS_CONFIG (club 1, mace 10).

A victory grants farm.dragonScales +1 in the visitor's warehouse, even when full;
it counts toward occupied capacity and sells for 200 coins. A loss atomically
clears the visited coop's eggs and deducts up to 100 visitor coins. Accrued egg
production ticks are consumed to prevent burned eggs reappearing. Recent result
IDs prevent duplicate settlement; failed settlements show a clickable retry.
Leaving a visit removes the actor, effects and timers.

## Group isolation

Game pages share js/game-context.js. The selected lastGroupId takes precedence
above a stale profile groupId; legacy profile groupId is used only when no group
selection has been saved. Entry verifies the account is in groups.members before game data is accessed.
Missing group/account information stops initialization
instead of falling back to a shared default_group. Storage changes, restored
pages and focus changes reload a game whose group/account no longer matches.

Farm state remains at groups/{selectedGroupId}/users/{accountId}. Game records
and permissions retain their existing group-prefixed IDs. RPS reward points now
also contain groupId and accountId. The group roster comes from groups.members,
with profiles queried by accountId, including people who belong to many groups.

Game broadcast settings are now groups/{groupId}/settings/gameConfig. Admins
select a room from that group; broadcasts verify the room still belongs to it.
Each group must configure its broadcast room separately. Old global settings
and default_group progress remain untouched and are never automatically copied
into a selected group, since their owning group cannot be inferred safely.

## Public villages

Group metadata uses farmVillageVisibility: "public" or "closed" (missing means
closed). Admin game permissions contain one village-type setting for the entire
selected group. Only members of a public source village can browse other public
villages. Closing either side stops an external visit.

LobbyScene opens the player's own village first, titled {group.name}村落. Its
right-arrow button and horizontal swipe open the public directory. Only public
groups are queried, excluding the source group; visible results are paginated
10 groups at a time. The search combobox filters normalized keywords, offers
up to six keyboard/clickable suggestions, and supports the displayed 村落 suffix.
The member roster shows established farms only and paginates nine farms per page.
Search overlays follow the canvas size and are removed on scene shutdown.

VisitScene carries targetGroupId independently from CURRENT_GROUP_ID. Target
farm reads/egg losses use the target group; rewards, weapons, coins, moral and
warehouse use the original group. Transaction callbacks read both groups and
verify public status/membership before writing, so concurrent privacy changes
invalidate those reads and retry. External visits also observe group documents
and return home if either side closes or a participant leaves. Dragon settlement
uses the same access check and target group. The browser's selected group never
changes merely because another village is visited.

Theft cooldown keys encode [targetGroupId, targetAccountId] in the player's
farm.villageStealCooldowns. Existing same-group stealCooldowns still apply. Failed
attempts commit cooldown and moral cost without taking eggs; an exception cannot
roll those costs back. Probability is sampled once across transaction retries.

## Village interface art

Lobby controls use AI-generated painterly UI surfaces made to match the existing
background and coop: ui-wood.webp, ui-wood-selected.webp, ui-parchment.webp and
ui-page.webp. Flower/leaf details, warm oak and cream paper replace flat green
rectangles. Header, navigation, farm nameplates, directory cards and numbered
pagination share these surfaces. Public cards include a coop thumbnail.

js/farm/village-ui.js centralizes hover/press feedback and selected state. Active
navigation uses a gold highlight; the selected page uses a cream paper surface.
css/farm-village.css styles the search and autocomplete with the same palette,
including visible keyboard focus. Scene shutdown still removes the search UI.

## Validation

Start a static server in the repository. Tests require Playwright, curl, and
system Chromium. Set FARM_BASE_URL if not using port 8000.

- node tests/farm-public-villages.cjs: admin settings, default closed, swipe,
  10-item pagination, autocomplete, established-farm roster, cross-group theft,
  cooldowns, dragon results and live closure.
- node tests/game-group-isolation.cjs: persistent in-memory A → B → A games,
  farm collection/shop, selected-group permissions, points, roster, broadcasts,
  cross-tab changes, browser Back, and missing-group handling.
- node tests/farm-dragon.cjs: encounter gate/odds, 600/60 hits, timing, atomic
  loss, guaranteed loot, retries, warehouse and shop sale, and shutdown.
- node tests/farm-map.cjs: proportional map, no duplicate art, 42 plant targets,
  coop/plant clicks and egg-laying bounds in home and visiting farms.
- node tests/farm-actors.cjs: routes at all coop levels, animations, defeat,
  escape, duplicate-event protection and village navigation.
- node tests/farm-hen-lifecycle.cjs: destroyed sprites and scene resync.
- node tests/farm-hen-avoidance.cjs: blocked paths, moving threats, resync,
  sick hens and two predators.
- node tests/farm-predator-timing.cjs: real 50/60-second arrival after attacks;
  allow about one minute.

Tests mock Firebase and never write production data. Group-isolation and dragon tests execute real
transaction callbacks against an isolated in-memory store; older actor tests
count transaction requests without executing their callbacks.

## Gorilla boss

The supplied gorilla reference was used to produce `gorilla-sheet.png` (1254×1254,
transparent, four columns/four rows: run, right-facing punch, hit/dizzy, defeat).
Load with `gorilla-sheet.json`, not a fixed-size spritesheet: rows and columns
alternate 313/314 source pixels, with normalized source sizes and per-frame
pivots to keep feet on the ground. `gorilla-fang.png` is the matching ivory fang
loot icon. See docs/farm-gorilla.md and tests/farm-gorilla.cjs for gameplay and
inventory validation.

## Weapons

`battleaxe.png` and the replacement `mace.png` are transparent hand-painted
weapon icons generated for the village. They share warm wood, leather, steel
and brass details. The same textures are used in the shop, warehouse and combat
swing; no pixel-matrix mace remains. See docs/farm-weapons.md for balance and
`node tests/farm-weapons.cjs` for isolated purchase/equipment/sale/combat checks.

## Chicken breeds

`hen-sheet.png`, `silkie-sheet.png` and `bresse-sheet.png` are transparent 1254 × 1254 atlases
with 4 × 4 frames. The first eight frames are idle/blink/fluff/peck; the last
eight are walking. Load their matching JSON atlas files because cells alternate
313 and 314 pixels, normalized to 314 × 314. The charcoal silkie has a fluffy
crest and feathered feet; the white Bresse has a red comb and blue legs.
The redesigned mother hen has creamy golden feathers, a red comb, and orange
beak/feet. All three breeds now share the same illustrated sprite style.
The legacy root `hen.png` is retained but no longer loaded by the farm game.
They render at 64px frame width
in both home and visited farms, with breed-specific animations and shared
path planning. Breed egg icons use ivory and cool white/blue palettes.
See docs/farm-poultry.md for economy, migration, production and feeding rules.
