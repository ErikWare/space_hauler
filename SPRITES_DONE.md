# Sprites Done

Generator bug fixed. All assets generated.

## New explosion scenes (12 PNGs, 3 candidates each)
- `explosion_debris_field` — hull fragments, amber fire glow
- `explosion_cockpit_impact` — cockpit red-flood, cracked viewport  
- `explosion_debris_portrait` — battered pilot, cracked visor
- `explosion_silent_wreck` — cold aftermath, dark space

## Backfills complete
All 7 backgrounds + 3 splashes upgraded from 1 → 3 candidates.

## generate.py fix
Line 195: `len(lock)` → `len(lock) if lock else 0`
Added skip-if-exists guard so re-runs top up without overwriting.

## Next steps
- Wire explosion sprites into VN_ASSETS in `src/game/visual_novel.js`
- Use them in Act 1 complication scenes
- Continue to Acts 2–3
