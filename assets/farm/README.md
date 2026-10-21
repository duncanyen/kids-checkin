# Farm scenery

Original AI-generated artwork created for 咕咕村落: a warm, hand-painted rural
landscape, timber and terracotta chicken coop, vegetable bed, and cabbage plant.
The WebP files are optimized runtime exports; transparent props retain alpha.

| File | Pixels | Use |
| --- | --- | --- |
| `background.webp` | 780 × 1688 | Full portrait background, drawn at 390 × 844 |
| `coop.webp` | 320 × 300 | Chicken coop, drawn at 160 × 150 before upgrades |
| `garden-bed.webp` | 660 × 660 | Soil and timber border, drawn at 330 × 330 |
| `cabbage.webp` | 64 × 64 | Individual interactive plants, drawn at 24 × 24 |
| `signboard.webp` | 88 × 100 | Cabbage sign, drawn at 44 × 50 with the existing help action |
| `wolf-sheet.webp` | 1024 × 1024 | Pixel art matching the hen, 4 × 4 grid, 256 × 256 per frame |
| `tiger-sheet.webp` | 1024 × 1024 | Pixel art matching the hen, 4 × 4 grid, 256 × 256 per frame |

`js/farm/scenery.js` shares the layout between the home and visiting farms.
The village member list reuses the painted coop at 96 × 90. Planting uses
the existing 100 interactive plants and game logic. Coop sizes
remain 1×, 1.2× and 1.5× for the three upgrade levels. The other farm scenes
reuse the landscape; shop icons reuse the coop texture.

Painted textures use linear filtering. The hen, wolf and tiger spritesheets
use nearest filtering so their pixel outlines remain sharp.

The predator sheets contain four walk frames (0–3), four run frames (4–7),
four stunned frames with golden stars (8–11), and four non-graphic defeat
frames (12–15). `js/farm/predators.js` registers and controls these states;
the final defeat pose stays visible before the existing fade-out. Repeated
hits restart the hit pose without pausing travel. Resolved events cannot
resume walking or resolve twice.

Predators have three-quarter rear views facing northeast, mirrored for northwest.
Spawn points and the coop-front destination form a 45-degree diagonal matching
that view. Their grounded origins keep feet on the path. Approaches walk from
the first frame and take 60 seconds for wolves or 50 seconds for tigers, including
time spent playing hit poses. Run poses are used for escape.
Predators render at 192 × 192 (twice their previous display size). These lossless
WebP sheets are exported from the full-resolution originals, not enlarged from
the previous 64-pixel frames. Hit areas scale to match their visible bodies.

Hen spawn points and wander destinations share a rectangular clearing in front
of the coop. Its upper edge follows the coop's upgraded height, with clearance
for the whole hen sprite. Egg-laying gathers hens in that clearing as well.
`js/farm/hen-navigation.js` plans complete paths around the visible predators,
with clearance for the hen's body. Visiting farms recheck paths every 200 ms
and immediately when an event starts. Existing hens retreat if necessary;
new hens spawn in safe space. Sick hens can retreat too, keeping their status
icon attached. Defeated animals remain obstacles until they fade out. Normal
wandering resumes after the scene clears; no remote farm data is changed by
this visual movement behavior.

Browser checks (requires Playwright, system Chromium and curl): start a static
server in the repository, then run `node tests/farm-hen-lifecycle.cjs` and
`node tests/farm-actors.cjs`. Set `FARM_BASE_URL` if using a port other than 8000.
Both suites mock Firebase; actor tests count transactions without executing
their callbacks or writing remote data.
`node tests/farm-predator-timing.cjs` additionally checks actual 50/60-second
arrivals after repeated attacks; allow about one minute for that test.
`node tests/farm-hen-avoidance.cjs` covers blocked paths, moving predators,
farm resync, upgraded coops, sick hens, and two visible predators.
