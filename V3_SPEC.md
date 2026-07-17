# Space Hauler v3 Spec

## Overview
Full rewrite of game.html. Keep economy/tow/sell/upgrade loop. Replace everything else.

## 1. Rendering — 2.5D Pseudo-3D
- Camera: ~30° pitch off top-down. Objects drawn with slight vertical screen offset based on world Y (things "below" drawn higher on screen = depth illusion).
- Rocks: pseudo-sphere shading. Radial gradient (bright top-left highlight, dark bottom-right shadow). Each type keeps its color.
- Ship: 3/4 view (nose forward-right). Hull with slight curve using arcs. Engine glow on back pulses with charge level.
- Station: ring rendered as foreshortened ellipse (gives 3D ring feel). Blue-lit docking hub center.
- Stars: 3 parallax layers (z=0.2, 0.5, 0.9). ~400 stars total.

## 2. Controls — Burst Impulse Engine
Replace continuous thrust with charge-and-release:

```
HOLD WASD / touch-hold direction:
  - Ship instantly rotates to face that direction
  - Charge meter fills: 0 → max over 0 to 2.5s
  - Engine glow builds: dim blue → bright orange → white at max charge
  - Rising audio tone

RELEASE key/touch:
  - Apply impulse = chargeLevel * maxImpulse in held direction
  - chargeLevel = clamp(holdTime / 2.5, 0, 1)
  - Ship drifts: natural drag 0.994/frame at 60fps (full charge ~8-10s drift)
  - Fuel cost = chargeLevel * baseCost * towMassMultiplier

RETARGET mid-drift:
  - New charge at any time, adds to existing velocity (realistic momentum)

TOWING:
  - Drag increases to 0.985/frame (forces continuous boosting)
  - Rock lerps to stern of ship as before

FUEL:
  - Only consumed on impulse release (not while drifting)
  - Zero fuel = no impulse possible, drift only

CHARGE HUD:
  - Arc indicator around ship, fills 0→2π as charge builds
  - Color: dim-blue → orange → white
```

SPACE / tap-center: tractor beam toggle (unchanged)
Zoom: scroll/pinch 0.08 (full field) → 3.0 (close). Smooth lerp.

## 3. Space Junk Floaters (~60 objects)
Inert drifting debris. No physics interaction, no value. Drift at 0.5–2 u/s with slow spin.

Types (procedural canvas):
- `junk_can`: fuel canister (rectangle + endcaps, grey/rust)
- `junk_panel`: solar panel fragment (thin rect, dark + reflective strip)
- `junk_crate`: cargo crate (square + corner bolts, worn yellow)
- `junk_debris`: irregular small rock fragment (grey)

Give world visual life + depth perception cue.

## 4. Procedural Planets (3 per game, seeded)
Large spheres, radius 800–2000 world units, placed ≥3000 units from station.

Types:
- `ice_world`: pale blue-white. Surface: white cracked ice lines. Atmosphere: cyan halo. Ring: silver rocks.
- `fire_world`: deep orange-red. Surface: lava cracks (orange gradient). Atmosphere: smoky red halo. Ring: dark rocks.
- `gas_giant`: purple/green banded. Horizontal stripe bands. Atmosphere: lavender halo. Colorful ring with gaps.

Draw as radial-gradient sphere (canvas):
```js
const grd = ctx.createRadialGradient(cx-r*0.3, cy-r*0.3, r*0.1, cx, cy, r);
```
Ring: foreshortened ellipse ring (1.4r → 2.2r), dotted with small rock strokes.

Planet physics:
- Within 1.5× radius: gentle gravity pull (2 u/s² toward center). Player must boost to escape.
- No collision damage from planets.
- Ore rocks in ring zones: +50% sell bonus. Toast "RING BONUS +50%".

At zoom ≤ 0.25: label planets with type name (small text). Label station "HOME".

## 5. Collision Detection + Health

Ship health = 100. HUD: shield bar (top-left, below fuel bar).

Ship vs Ore Rock:
- Circles: ship r=16, rock r = rock.size * 20
- On overlap: elastic bounce (reflect velocity components by mass ratio)
- Damage: 5 + rock.mass * 3 HP (junk=2, platinum=20)
- 0.8s invincibility window after hit
- Visual: red flash 0.3s
- SFX: noise crunch

At 0 HP: particle burst, game-over overlay ("HULL BREACH — press R"), press R to restart.

Ship vs Junk: bounce, 1 HP damage.
Rock vs Rock: elastic bounce when not in cargo. No damage.

## 6. Camera + Zoom
- Zoom 0.08: entire world visible (~6000 unit diameter field)
- Zoom 3.0: close up
- Smooth lerp factor 0.12/frame
- Zoom out = show full map, labels, planet locations, rings

## 7. Assets Manifest
Update assets/manifest.json. All status = "fallback". View: "3/4 iso" for ships/rocks/junk, "front-on sphere" for planets.

Style line (same for all): "Clean 2D game art, bold silhouette, soft shading, sci-fi aesthetic. Transparent background. No text, no drop shadow, no background scene."

Sprites:
```
ship          w:64 h:64   "Mining tug spaceship, 3/4 iso view, nose right and slightly up, gold-yellow hull, silver swept wings, blue engine exhaust port, no background."
station       w:160 h:160 "Space station ring, 3/4 iso, silver-blue ring with 6 spokes, central blue glowing docking hub, no background."
rock_junk     w:64 h:64   "Grey debris asteroid, 3/4 iso, rough irregular sphere, crater pits, matte grey, no background."
rock_copper   w:64 h:64   "Copper-orange asteroid, 3/4 iso, rough sphere, copper-brown tones with orange metallic veins, no background."
rock_silver   w:64 h:64   "Silver asteroid, 3/4 iso, sphere shape, bright silver-white metallic surface, reflective sheen, no background."
rock_gold     w:64 h:64   "Gold asteroid, 3/4 iso, sphere shape, deep gold and amber tones, bright gold vein glints, no background."
rock_platinum w:64 h:64   "Platinum asteroid, 3/4 iso, sphere shape, pale teal-cyan metallic surface, iridescent glow, exotic and rare-looking, no background."
planet_ice    w:512 h:512 "Ice world planet, front-on sphere, pale blue-white globe, cracked ice surface texture, thin cyan atmosphere halo, no background."
planet_fire   w:512 h:512 "Fire world planet, front-on sphere, deep orange-red globe, glowing lava crack surface, smoky red atmosphere, no background."
planet_gas    w:512 h:512 "Gas giant planet, front-on sphere, swirling purple and green bands, lavender atmosphere halo, large majestic scale, no background."
junk_can      w:48 h:48   "Tumbling fuel canister, 3/4 iso, cylindrical, grey and rust-orange, dented, space debris, no background."
junk_panel    w:64 h:32   "Broken solar panel fragment, 3/4 iso, thin rectangular piece, dark frame with blue-silver reflective panel cells, no background."
junk_crate    w:48 h:48   "Cargo crate tumbling in space, 3/4 iso, square box shape, worn yellow paint, metal corner brackets, no background."
junk_debris   w:40 h:40   "Small irregular rock debris, 3/4 iso, jagged chunk, dark grey, no background."
```

## 8. selfTest Coverage
- Burst charge cycle: chargeLevel accumulates correctly with time
- Impulse applies to velocity on release
- Tow drag increases correctly
- Collision circle overlap → bounce + damage registered
- Planet gravity pull within 1.5r
- Health → 0 → game over state
- Zoom clamped 0.08 to 3.0
- Full buy/sell/upgrade loop

## 9. Constraints
- Single HTML file, no external deps
- All game logic runs headless (selfTest in Node)
- Procedural canvas sprites (art swapped in later via Grok)
- HARNESS comment block preserved at top
- LEDGER.md: add v3 entry
