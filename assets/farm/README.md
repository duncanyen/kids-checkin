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

`js/farm/scenery.js` shares the layout between the home and visiting farms.
Planting uses the existing 100 interactive plants and game logic. Coop sizes
remain 1×, 1.2× and 1.5× for the three upgrade levels. The other farm scenes
reuse the landscape; shop icons reuse the coop texture.

Painted textures use linear filtering. The existing hen spritesheet explicitly
uses nearest filtering so its animation frames remain sharp.
