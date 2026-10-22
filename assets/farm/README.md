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

Painted backgrounds use linear filtering. Hen, wolf and tiger pixel sprites
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

## Validation

Start a static server in the repository. Tests require Playwright, curl, and
system Chromium. Set FARM_BASE_URL if not using port 8000.

- node tests/farm-map.cjs: proportional map, no duplicate art, 42 plant targets,
  coop/plant clicks and egg-laying bounds in home and visiting farms.
- node tests/farm-actors.cjs: routes at all coop levels, animations, defeat,
  escape, duplicate-event protection and village navigation.
- node tests/farm-hen-lifecycle.cjs: destroyed sprites and scene resync.
- node tests/farm-hen-avoidance.cjs: blocked paths, moving threats, resync,
  sick hens and two predators.
- node tests/farm-predator-timing.cjs: real 50/60-second arrival after attacks;
  allow about one minute.

Tests mock Firebase, counting transactions without executing their callbacks
or writing production data.
