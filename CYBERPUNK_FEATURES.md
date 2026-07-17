# Space Hauler — Night City Cyberpunk Update

Open `game.html` in a browser to play. All changes are in `src/game/planet_surface.js`.

---

## Visual Atmosphere
- **Night sky** — 120 twinkling stars, purple/magenta smog horizon
- **City light dome** — neon light pollution glow above Night City, tracks camera
- **Acid rain** — 180 diagonal neon cyan drops, continuous
- **Lightning strikes** — random white-blue flash ~once per 20 seconds
- **Screen glitch** — horizontal pixel displacement + chromatic aberration every few seconds
- **Neon puddle reflections** — ~25% of road tiles shimmer with colored reflections
- **Cinematic vignette** — dark edges around the full screen

## Buildings
- All 31 city types recolored near-black with per-type neon glow
- **Animated windows** — each with own color (cyan/yellow/pink/purple/teal) + flicker; 18% permanently dark
- **Floating holographic signs** — neon emoji + name bobs above interactive buildings

## NPCs
- **Player** — dark suit, glowing cyan visor + chest stripe
- **8 NPC cars** — neon underglow + white LED headlights on 5 routes
- **12 NPC pedestrians** — tiny neon stick figures, each different color, walking sidewalks

## HUD & Interface
- Cyberpunk proximity cards (scanlines, corner brackets, neon border, [E] badge)
- **RADAR mini-map** — player (cyan), ship (blue), Rover (orange), interactive buildings (colored), resources (yellow)
- **Boot sequence** — 6-line terminal text fades in on landing
- **Neon interaction flash** — full-screen color bloom on E-key
- **Transaction panel** — "+N ₡ / BALANCE: N CREDITS" overlay on sales
- Hint bar with contextual text for all 6 interactive buildings

## Interactive Buildings (press E)
| Building | Action |
|---|---|
| Market Hall | Sell: wood×8, stone×12, berry×5 cr |
| Traders Guild | Sell at +50%: wood×12, stone×18, berry×8 cr |
| The Inn | Rest — all resources respawn (free) |
| Cantina | Random street gossip (6 lines) |
| Med Bay | Heal — 20 credits |
| Repair Shop | Rover diagnostic |

## Controls
WASD: move · E: interact/harvest/enter Rover · Arrow keys: drive · B: build mode · M: launch · F: quick-sell · Pinch/scroll: zoom

## Build
`python build.py --check` from space_hauler/ — must be ALL GREEN
