# Space Hauler — Sprite Manifest

All sprites generated via the xAI `grok-imagine-image` API (see `gen.py` / `batch_gen.py`).
Shared style anchor on every prompt: *"space hauler game art, dark space background, vibrant color, clean digital illustration style"*.
Source images are 1024×1024 PNGs (true PNG via `sips`). Regenerate any file by deleting it and re-running `python3 batch_gen.py` (resumable — it skips files that already exist).

## Ships — top-down, square composition
| File | In-game use |
|------|-------------|
| `vulture_tug.png` | Tier-1 player ship: small battered salvage hauler (starting vessel) |
| `atlas_freighter.png` | Tier-2 player ship: mid-tier industrial freighter with cargo pods |
| `aegis_battlecruiser.png` | Tier-3 player ship: heavily-armed battlecruiser (endgame vessel) |
| `vex_fighter.png` | Vex faction enemy: angular crystalline fighter |
| `krag_raider.png` | Krag faction enemy: brutal spiked raider |
| `nox_phantom.png` | Nox faction enemy: translucent void-cloaked phantom |
| `companion_drone.png` | Allied/companion utility drone that escorts the player |

## Story characters — portrait, head & shoulders
| File | In-game use |
|------|-------------|
| `commander_portrait.png` | The player captain's portrait (dialogue / HUD) |
| `vex_leader.png` | Vex faction leader portrait (story dialogue) |
| `krag_leader.png` | Krag warlord leader portrait (story dialogue) |
| `nox_leader.png` | Nox faction leader portrait (story dialogue) |
| `station_commander.png` | Friendly station-commander NPC portrait (hub dialogue) |

## Story scenes — widescreen cinematic
| File | In-game use |
|------|-------------|
| `opening_scene.png` | Intro cutscene: lone cargo ship in an asteroid field |
| `first_contact.png` | First-contact cutscene: standoff with an alien fleet |
| `outpost_siege.png` | Combat cutscene: player assaulting an enemy outpost |
| `faction_warning.png` | Threat cutscene: alien warlord's viewscreen warning |
| `victory_scene.png` | Victory cutscene: player fleet over a conquered system |

## World objects
| File | In-game use |
|------|-------------|
| `station_vex.png` | Vex faction space station (crystalline architecture) |
| `station_krag.png` | Krag faction space station (industrial/brutal) |
| `station_nox.png` | Nox faction space station (shadowy/cloaked) |
| `outpost_player.png` | Player-owned outpost/fortification |
| `outpost_enemy.png` | Enemy outpost (siege target) |
| `asteroid_ore.png` | Minable ore asteroid (resource node) |
| `warp_gate.png` | Warp gate for system-to-system travel |
| `nebula_blue.png` | Ambient blue nebula background element |
| `nebula_red.png` | Ambient red nebula (danger/warning zones) |
| `nebula_green.png` | Ambient green nebula (alien/mystery zones) |

## Junk / salvage floaters — inert drifting debris (haul to a station → Forge drop)
| File | In-game use |
|------|-------------|
| `junk_can.png` | `junk_can` floater — cracked fuel canister (tractor/propulsion salvage) |
| `junk_panel.png` | `junk_panel` floater — broken solar-panel fragment (shield/solar salvage) |
| `junk_crate.png` | `junk_crate` floater — worn cargo crate (tractor-slot/repair salvage) |
| `junk_debris.png` | `junk_debris` floater — twisted scrap-metal chunk (armor salvage) |

## UI / icons — clean, small
| File | In-game use |
|------|-------------|
| `icon_vex.png` | Vex faction logo/badge (HUD, map, diplomacy) |
| `icon_krag.png` | Krag faction logo/badge (HUD, map, diplomacy) |
| `icon_nox.png` | Nox faction logo/badge (HUD, map, diplomacy) |
| `icon_victory.png` | Victory / empire-established achievement badge |

**Total: 31 sprites** (7 ships, 5 characters, 5 scenes, 10 world objects, 4 icons).
