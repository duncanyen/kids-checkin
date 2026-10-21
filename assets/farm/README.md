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
| `wolf-sheet.webp` | 1024 × 1024 | 4 × 4 sprite grid, 256 × 256 per frame |
| `tiger-sheet.webp` | 1024 × 1024 | 4 × 4 sprite grid, 256 × 256 per frame |

`js/farm/scenery.js` shares the layout between the home and visiting farms.
Planting uses the existing 100 interactive plants and game logic. Coop sizes
remain 1×, 1.2× and 1.5× for the three upgrade levels. The other farm scenes
reuse the landscape; shop icons reuse the coop texture.

Painted textures use linear filtering. The existing hen spritesheet explicitly
uses nearest filtering so its animation frames remain sharp.

The predator sheets contain four walk frames (0–3), four run frames (4–7),
four stunned frames with golden stars (8–11), and four non-graphic defeat
frames (12–15). `js/farm/predators.js` registers and controls these states;
the final defeat pose stays visible before the existing fade-out. Repeated
hits restart the stun; resolved events cannot resume walking or resolve twice.

Hen spawn points and wander destinations share a rectangular clearing in front
of the coop. Its upper edge follows the coop's upgraded height, with clearance
for the whole hen sprite. Egg-laying gathers hens in that clearing as well.

Browser checks (requires Playwright, system Chromium and curl): start a static
server in the repository, then run `node tests/farm-hen-lifecycle.cjs` and
`node tests/farm-actors.cjs`. Set `FARM_BASE_URL` if using a port other than 8000.
Both suites mock Firebase; actor tests count transactions without executing
their callbacks or writing remote data.
