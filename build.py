#!/usr/bin/env python3
"""
Space Hauler v4 build.

Concatenates src/modules/*.js (the eight Forge modules, in dependency order) then
src/**/*.js (the game, in load order), and wraps the result in a single
self-contained game.html with the HARNESS comment markers preserved.

The nine modules are plain IIFEs that attach their global (ForgeItemSystem …
ForgeNPC); inlined first, they satisfy every bare-global reference the game code
makes. No external dependencies, no build tooling — just string concatenation.

    python3 build.py            # → game.html
    python3 build.py --check    # build, then run the headless selfTest in Node
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "game.html")

# Dependency order matters: item_system + equipment before faction; item_system
# + combat before faction/npc; world before station_store. (All attach globals.)
MODULES = [
    "item_system", "equipment_system", "hud",
    "world", "station_store", "combat", "faction", "npc",
]

# Game load order: config (CONFIG + GAME) first, then camera/input/physics, the
# world builders (sprites defined before use), then the game systems, then main
# (init/update/draw/selfTest/boot) last.
GAME_FILES = [
    "core/config.js", "content/catalog.js", "content/planet_data.js", "game/sprites.js", "core/camera.js", "core/input.js", "core/physics.js",
    "world/stars.js", "world/planets.js", "world/ores.js", "world/fields.js", "world/regions.js", "world/junk.js", "world/rendering.js",
    "game/audio.js", "game/player.js", "game/economy.js", "game/item_icons.js", "game/ui.js", "game/encounters.js", "game/enemy_bases.js", "game/outposts.js",
    "game/regions.js", "game/politics.js", "game/victory.js", "game/tutorial.js",
    "game/drones.js", "game/ships.js", "game/contracts.js", "game/fleet.js", "game/npc_traders.js", "game/trade_routes.js", "game/galaxy_map.js",
    "game/save.js",
    "game/skills.js",
    "game/planet_surface.js",
    "main.js",
]

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>Space Hauler v4</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128640;</text></svg>">
<!--
=== HARNESS:HEADER ==========================================================
GAME:      space_hauler — SPACE HAULER v4 (2.5D burst-impulse mining / combat)
BUILT BY:  build.py  (src/modules/*.js + src/**/*.js → single game.html)
INTEGRATES the eight Forge modules (inlined below under HARNESS:MODULES):
  ForgeItemSystem  procedural item rolls / junk-drop mapping
  ForgeEquipment   flat 6-slot fit rack (any item any slot), derived stats, skill ticks
  ForgeHUD         shield/armor/hull bars, fuel, cargo, minimap, left-column skills, warp
  ForgeWorld       12k field: seeded stations, discovery, nebulae, warp gates
  ForgeStore       per-station storefront: buy/sell, set-home, warp-gate buy
  ForgeCombat      lock-on, weapon auto-fire, 3-layer typed damage, projectiles
  ForgeFaction     Vex/Krag/Nox alien groups + approach/kite/retreat AI
  ForgeNPC         station miners, reputation, docking fees, outlaw turrets
CONTROLS:  drag/hold empty space — aim + thrust (CONSTANT accel · BURST charge/release)
           tap a rock/scrap in beam range — tractor-tow it · tap an alien in scan
           range — lock on · tap a left-column skill button to toggle it · SPACE tractor ·
           E dock · F fuel · Q engine mode · B base · L launch · 1-6 skills · R restart
HEALTH:    3 layers — SHIELD (regen 5/s) → ARMOR (repair only) → HULL (0 = respawn home).
PHASE 3:   drone trade — refine ore→bars at dock, launch tiered trade convoys
           (Drone Bay tab); drones travel station-to-station as cyan minimap dots.
PHASE 4:   mercenary contracts — station boards (Contracts tab) offer strike/
           pirate-clear/salvage/escort/bounty/defense jobs; one active at a time,
           tracked in a HUD box top-right, turned in at the issuing station.
PHASE 5:   player fleet — own up to 5 drones with roles: 3 ESCORTS fly
           formation / spread targets / repair-retreat, the rest idle in the
           hangar or fly trade runs (FLEET tab assigns roles; teal trails).
PHASE 6:   galaxy map (M / MAP button — stations, warp routes, drones, traders,
           encounters, contract marker) + NPC traders looping station routes;
           pirates raid them ("save the convoy" bonus) and so can you (rep hit).
PHASE 7:   multi-ship — CONFIG.hulls registry (Vulture starter / Atlas / Aegis,
           bought for credits at the SHIPS market tab, progression-gated by
           outpost captures OR max danger reached; buying transfers the fitted
           modules and flies the new hull out at full health); per-ship loadouts
           persist on s.ships[i].slots, the ForgeEquipment singleton is always
           the ACTIVE ship's rack (switchActiveShip snapshots + reloads it).
FLIGHT is on the canvas; docked UI is seven DOM overlay tabs — LOADOUT (#loadoutPanel:
ship-portrait carousel over ships + drones, 6 flat slots, tap-for-delta previews via
the stateless applyItemsToStats), STORE, WARP, SHIPS (hull market), HANGAR (refine
ore + build drones), FLEET (drone role command), JOBS. All game logic is
renderer-free and runs headless — selfTest plays the whole loop in Node.
=============================================================================
-->
<style>
  html,body{margin:0;height:100%;background:#05070d;overflow:hidden}
  #stage{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}
  /* canvas fills the viewport in any orientation (aspect set live in main.js boot) */
  canvas#game{background:#05070d;display:block;touch-action:none}

  /* ---- STATION BAY · loadout tab (DOM overlay; shown only while docked on LOADOUT) ---- */
  #loadoutPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #loadoutPanel.show{display:flex}
  #loHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #loHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  .ghSp{flex:1}
  .ghPill{padding:5px 10px;border-radius:8px;background:#16202f;border:1px solid #2a3a52;font-size:12px}
  .ghPill b{color:#ffd27a}
  .ghTab,.ghBtn{padding:8px 13px;border-radius:9px;border:1px solid #2a3a52;background:#16202f;color:#e8edf4;
    font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.5px}
  .ghTab:hover,.ghBtn:hover{background:#1e2b3e}
  .ghTab.on{background:#1c5a54;border-color:#2c8b82;color:#dffdf8}
  .ghBtn.go{background:#1c5a54;border-color:#2c8b82;color:#dffdf8}
  #loBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #loBody .ghCol{flex:none}
  .ghCol{background:rgba(13,20,32,.66);border:1px solid #223047;border-radius:12px;padding:12px;
    display:flex;flex-direction:column;min-height:0}
  .ghCol h2{margin:0 0 8px;font-size:11px;letter-spacing:1.2px;color:#7f8ea6;text-transform:uppercase}
  /* ship carousel: arrows · 3 slots · portrait · 3 slots · arrows */
  #loShipRow{display:flex;align-items:center;justify-content:center;gap:8px}
  .loArrow{padding:16px 8px;font-size:13px;flex:none}
  /* slots now live in a 3-col grid below the portrait, not flanking it */
  #loSlotsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;margin-top:10px}
  #loSlotsGrid .ghSlot{aspect-ratio:auto}
  #loPortrait{flex:none;display:flex;flex-direction:column;align-items:center;gap:5px;padding:2px 4px;min-width:140px;max-width:160px}
  #loShipCanvas{width:132px;height:132px}
  #loShipName{font-size:14px;font-weight:700;letter-spacing:1px;color:#8fd0ff;text-align:center;overflow-wrap:break-word;word-break:break-word}
  #loShipSub{font-size:10px;color:#7f8ea6;text-align:center;overflow-wrap:break-word;word-break:break-word}
  #loPageLbl{color:#57d1c9;letter-spacing:.5px}
  #loActiveBtn{font-size:10px;padding:6px 14px}
  #loActiveBtn.on{background:#1c4a30;border-color:#3a8a50;color:#7bd88f;cursor:default}
  #loStats{display:flex;flex-direction:column;gap:6px}
  #loInvWrap{flex:1;min-height:140px}
  #loInv{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;padding-right:4px;
    align-content:start}
  .ghTile{border:1px solid #223047;border-radius:10px;background:#0e1626;cursor:pointer;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
    padding:6px 4px;touch-action:none;position:relative}
  .ghTile:hover{background:#132033}
  .ghTile .ghBadge{width:30px;height:30px;font-size:12px;border-radius:8px}
  .ghTileName{font-size:8px;line-height:1.15;text-align:center;color:#c7d2e0;max-height:20px;overflow:hidden;
    word-break:break-all}
  .ghRow{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid #223047;border-radius:9px;
    background:#0e1626;cursor:pointer;touch-action:none}
  .ghRow:hover{background:#132033}
  .ghRow.sel{border-color:#57d1c9;background:#123028;box-shadow:inset 0 0 14px rgba(87,209,201,.25)}
  .ghDot{width:10px;height:10px;border-radius:50%;flex:none}
  .ghName{flex:1;font-size:12px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ghRar{font-size:10px;font-weight:700;letter-spacing:.4px}
  .ghVal{font-size:11px;font-weight:700;color:#ffd27a;flex:none}
  .ghBadge{width:22px;height:22px;flex:none;border-radius:6px;display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.5)}

  /* ---- item modal ---- */
  #ghModal{position:fixed;inset:0;z-index:30;display:none;align-items:center;justify-content:center;
    background:rgba(4,8,16,.75)}
  #ghModal.show{display:flex}
  .ghMBox{background:#0e1626;border:1px solid #2a3a52;border-radius:14px;padding:16px 20px;
    width:320px;max-width:90vw;max-height:85vh;overflow:auto;display:flex;flex-direction:column;gap:10px;color:#e8edf4}
  .ghMName{font-size:16px;font-weight:700;letter-spacing:.6px}
  .ghMRar{font-size:11px;font-weight:700;letter-spacing:.5px}
  .ghMVal{font-size:12px;color:#ffd27a;font-weight:700}
  .ghMSep{border:none;border-top:1px solid #223047;margin:2px 0}
  .ghMStatRow{display:flex;justify-content:space-between;font-size:11px;padding:2px 0}
  .ghMStatLbl{color:#8a9bb0}
  .ghMStatVal{font-weight:700;color:#e8edf4}
  .ghMActions{display:flex;gap:8px;margin-top:4px}
  .ghMActions button{flex:1;padding:10px;border-radius:9px;border:1px solid #2a3a52;background:#16202f;
    color:#e8edf4;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.5px}
  .ghMActions .eq{background:#1c5a54;border-color:#2c8b82;color:#dffdf8}
  .ghMActions .sl{background:#4a2030;border-color:#8b2c42;color:#ffdce4}
  .ghMQty{display:flex;flex-direction:column;gap:8px;padding:8px 0 2px}
  .ghMQtyRow{display:flex;justify-content:space-between;align-items:baseline;font-size:12px}
  .ghMQtyN{font-size:15px;font-weight:700;color:#dffdf8}
  .ghMQtyTotal{font-weight:700;color:#ffd27a}
  .ghMQtyStepper{display:flex;align-items:center;gap:10px}
  .ghMQtyStepper button{width:34px;height:34px;flex:none;border-radius:9px;border:1px solid #2a3a52;
    background:#16202f;color:#e8edf4;font-size:18px;font-weight:700;cursor:pointer;line-height:1}
  .ghMQtySlider{flex:1;-webkit-appearance:none;appearance:none;height:6px;border-radius:4px;
    background:#223047;outline:none;cursor:pointer}
  .ghMQtySlider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;
    border-radius:50%;background:#2c8b82;border:2px solid #dffdf8;cursor:pointer}
  .ghMQtySlider::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#2c8b82;
    border:2px solid #dffdf8;cursor:pointer}
  .ghSlot{aspect-ratio:1;border:2px dashed #33465f;border-radius:12px;background:#0e1626;cursor:pointer;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:6px;
    position:relative;overflow:hidden;touch-action:none}
  .ghSlot.filled{border-style:solid;border-color:#2c4a6a}
  .ghSlot.hot{border-color:#57d1c9;background:#123028;box-shadow:inset 0 0 18px rgba(87,209,201,.3)}
  .ghSlot .ghBadge{width:30px;height:30px;font-size:12px;border-radius:8px}
  .ghSlotName{font-size:9px;line-height:1.15;text-align:center;color:#c7d2e0;max-height:24px;overflow:hidden}
  .ghEmpty{color:#3a4a60;font-size:10px;letter-spacing:1px}
  .ghNote{color:#5a6a82;font-size:12px;padding:10px 2px}

  /* ---- STATION BAY · drone bay tab (DOM overlay; shown only while docked on DRONES) ---- */
  #dronePanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #dronePanel.show{display:flex}
  #drHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #drHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #drBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #drBody .ghCol{flex:none}
  #drBody #drActiveWrap{flex:1;min-height:120px}
  .drRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .drPill{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:#16202f;
    border:1px solid #2a3a52;font-size:11px}
  .drDot{width:9px;height:9px;border-radius:50%;flex:none}
  .drSq{width:9px;height:9px;border-radius:2px;flex:none}
  #drTiers{display:flex;gap:10px;flex-wrap:wrap}
  .drCard{flex:1;min-width:160px;border:1px solid #223047;border-radius:12px;background:#0e1626;
    padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:4px}
  .drCard:hover{background:#132033}
  .drCard.sel{border-color:#57d1c9;background:#123028;box-shadow:inset 0 0 14px rgba(87,209,201,.25)}
  .drCard.cant{opacity:.55}
  .drCardName{font-size:12px;font-weight:700;letter-spacing:.6px;color:#8fd0ff}
  .drCardLine{font-size:10.5px;color:#c7d2e0}
  .drCardLine.gold{color:#ffd27a;font-weight:700}
  .drCardLine.dim{color:#7f8ea6}
  .drLbl{font-size:10px;letter-spacing:1px;color:#7f8ea6;text-transform:uppercase}
  .drNum{width:30px;height:30px;border-radius:8px;border:1px solid #2a3a52;background:#16202f;color:#e8edf4;
    font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-right:4px}
  .drNum.on{background:#1c5a54;border-color:#2c8b82;color:#dffdf8}
  .drEsc{display:flex;align-items:center;gap:6px;font-size:11px;color:#c7d2e0;cursor:pointer}
  #drList{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0}
  .drDrone{display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid #223047;border-radius:9px;
    background:#0e1626;font-size:11px}
  .drTag{flex:none;padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.5px;border:1px solid transparent}
  .drTag.t0{background:#12314d;color:#bfe0ff;border-color:#5aa9e6}   /* Basic — steel blue */
  .drTag.t1{background:#0d3d3a;color:#c8fff7;border-color:#00e5cc}   /* Reinforced — teal */
  .drTag.t2{background:#2f1d52;color:#ecdcff;border-color:#b06cff}   /* Armored — purple */
  .drRoute{flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .drBarOut{flex:none;width:110px;height:7px;border-radius:4px;background:#1c2430;overflow:hidden}
  .drBarFill{height:100%;background:#57e6ff;border-radius:4px}
  .drBarFill.dead{background:#ff5060}
  .drDots{flex:none;display:flex;gap:2px;align-items:center}
  .drPip{width:5px;height:5px;border-radius:50%;background:#1c2430}
  .drPip.hp.on{background:#7bd88f}
  .drPip.sh.on{background:#57d1c9}
  .drPip.sh{margin-top:0}
  .drEta{flex:none;width:38px;text-align:right;color:#ffd27a;font-weight:700}
  .drStatus{flex:none;width:96px;text-align:right;font-size:9.5px;font-weight:700;letter-spacing:.5px}
  @media (max-width:720px){ #drTiers{flex-direction:column} .drStatus{width:auto} }

  /* ---- STATION BAY · contracts tab (DOM overlay; shown only while docked on CONTRACTS) ---- */
  #contractsPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #contractsPanel.show{display:flex}
  #ctHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #ctHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #ctBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #ctBody .ghCol{flex:none}
  #ctBody #ctListWrap{flex:1;min-height:120px}
  #ctActive{display:flex;flex-direction:column;gap:8px}
  #ctList{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0}
  .ctCard{border:1px solid #223047;border-radius:10px;background:#0e1626;padding:10px 12px;
    display:flex;flex-direction:column;gap:5px}
  .ctCard.done{border-color:#8a6f1e;box-shadow:inset 0 0 14px rgba(255,210,74,.12)}
  .ctHeadRow{display:flex;align-items:center;gap:8px}
  .ctTitle{flex:1;font-size:12px;font-weight:700;letter-spacing:.4px;color:#8fd0ff}
  .ctStars{font-size:11px;flex:none}
  .ctDesc{font-size:11px;line-height:1.4;color:#9aa7b8}
  .ctMeta{font-size:11px;font-weight:700;color:#ffd27a}
  .ctBtnRow{display:flex;gap:8px;margin-top:2px;flex-wrap:wrap}
  .ctBtnRow .ghBtn:disabled{opacity:.45;cursor:default}
  .ctAbandon{border-color:#5a2a34;color:#ff8a8a}

  /* ---- STATION BAY · fleet tab (DOM overlay; role-assignment command board) ---- */
  #fleetPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #fleetPanel.show{display:flex}
  #ftHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #ftHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #ftBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #ftBody .ghCol{flex:none}
  #ftBody #ftListWrap{flex:1;min-height:120px}
  #ftSummary{font-size:12px;color:#c7d2e0;letter-spacing:.4px;padding:2px 0}
  #ftList{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0}
  .flCard{border:1px solid #223047;border-radius:10px;background:#0e1626;padding:10px 12px;
    display:flex;flex-direction:column;gap:6px}
  .flTop{display:flex;align-items:center;gap:8px}
  .flRole{flex:none;padding:2px 8px;border-radius:6px;border:1px solid;font-size:9px;font-weight:700;letter-spacing:.6px}
  .flSlotLbl{flex:1;font-size:10px;font-weight:700;letter-spacing:.6px;color:#00e5cc}
  .flRemove{border-color:#5a2a34;color:#ff8a8a;padding:4px 9px;font-size:10px}
  .flToHangar,.flToEscort,.flTrade{padding:4px 9px;font-size:10px}
  .flToEscort{border-color:#1c5a54;color:#dffdf8}
  .flToEscort:disabled{opacity:.45;cursor:default}
  .flBars{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .flBarOut{width:90px}
  .drBarFill.flHp{background:#7bd88f}
  .drBarFill.flSh{background:#57d1c9}
  .flState{font-size:9px;font-weight:700;letter-spacing:.6px;color:#7f8ea6}
  /* ---- trade run: greyed in-flight card + ETA + destination picker ---- */
  .flTradeCard{opacity:.62;border-color:#2a3f52;background:#0b1420}
  .flEta{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.4px}
  .flTradeBar{width:100%;height:7px}
  .flNote{font-size:9.5px;color:#7f8ea6;letter-spacing:.3px}
  .flDest{display:flex;flex-direction:column;gap:5px;margin-top:6px;padding:8px;border:1px dashed #2c4a6a;
    border-radius:9px;background:#0b1526}
  .flDestHead{font-size:9.5px;color:#7f8ea6;letter-spacing:.4px;text-transform:uppercase}
  .flDestRow{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #223047;border-radius:8px;
    background:#0e1626;color:#e8edf4;font-family:inherit;cursor:pointer;text-align:left;width:100%}
  .flDestRow:hover{background:#14243a;border-color:#2c4a6a}
  .flDestName{flex:1;font-size:11px;font-weight:700;color:#8fd0ff}
  .flDestEta{flex:none;font-size:10px;color:#9ab8e0}
  .flDestPay{flex:none;font-size:11px;font-weight:700;color:#ffd27a;min-width:56px;text-align:right}
  .flDestCancel{align-self:flex-start;padding:3px 10px;font-size:9px;border-color:#5a2a34;color:#ff8a8a}
  /* ---- trade run management (convoy builder) ---- */
  .ftConvoyNew{align-self:flex-start}
  #ftConvoyShips{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
  .ftShipRow{display:flex;align-items:center;gap:9px;padding:7px 10px;border:1px solid #223047;border-radius:8px;
    background:#0e1626;color:#e8edf4;font-family:inherit;cursor:pointer;text-align:left;width:100%}
  .ftShipRow:hover{background:#14243a;border-color:#2c4a6a}
  .ftShipRow.sel{border-color:#57d1c9;background:#123028;box-shadow:inset 0 0 12px rgba(87,209,201,.22)}
  .ftShipChk{flex:none;width:16px;height:16px;border-radius:5px;border:1px solid #2c4a6a;display:flex;
    align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#57d1c9}
  .ftShipRow.sel .ftShipChk{background:#1c5a54;border-color:#2c8b82;color:#dffdf8}
  .ftShipHp{flex:1;text-align:right;font-size:10px;color:#9ab8e0}
  #ftConvoyDests{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}
  .flDestRow.sel{border-color:#57d1c9;background:#123028;box-shadow:inset 0 0 12px rgba(87,209,201,.22)}
  #ftConvoySum{font-size:11px;font-weight:700;color:#ffd27a;letter-spacing:.3px;margin:2px 0 8px}
  .ftConvoyLaunch{flex:none}

  /* ---- hangar ship showroom cards ---- */
  #drShips{display:flex;gap:10px;flex-wrap:wrap}
  .shCard{cursor:default}
  .shCard.owned{border-color:#2a5a34;box-shadow:inset 0 0 12px rgba(123,216,143,.10)}
  .drShipBuy{margin-top:4px;align-self:flex-start;border-color:#1c5a54;color:#dffdf8}
  .drShipBuy:disabled{opacity:.45;cursor:default}

  /* ---- ore rows in the Gear cargo list ---- */
  .ghOreSep{height:1px;background:#223047;margin:2px 0 4px}
  .ghOreRow{background:#0f1a28;border-color:#1e3040}
  .ghOreRow:hover{background:#14243a}
  .ghOreSell{padding:4px 10px;border-radius:7px;border:1px solid #2a5a34;background:#153020;color:#7bd88f;
    font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px;flex:none}
  .ghOreSell:hover{background:#1c4a30;border-color:#3a8a50}
  .ghSellAll{margin-top:2px;padding:6px 12px;border-radius:8px;border:1px solid #2a5a34;background:#153020;
    color:#7bd88f;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.5px;width:100%}
  .ghSellAll:hover{background:#1c4a30;border-color:#3a8a50}

  /* ---- ship loadout stats panel ---- */
  .ghStatRow{display:flex;align-items:center;gap:8px;font-size:11px}
  .ghStatLabel{flex:none;width:60px;color:#7f8ea6;font-weight:700;letter-spacing:.6px;text-transform:uppercase;font-size:9px}
  .ghStatBarOut{flex:1;height:8px;border-radius:4px;background:#1c2430;overflow:hidden;min-width:60px}
  .ghStatBarFill{height:100%;border-radius:4px;transition:width .2s}
  .ghStatVal{flex:none;width:52px;text-align:right;font-weight:700;font-size:11px}
  .ghDpsStat{color:#ff5060} .ghShieldStat{color:#57d1c9} .ghArmorStat{color:#ffd24a}
  .ghHullStat{color:#7bd88f} .ghSpeedStat{color:#8fd0ff} .ghCargoStat{color:#c7d2e0}
  .ghWeaponType{font-size:10px;color:#7f8ea6;padding:2px 0}

  /* ---- unequip button on equipped slots ---- */
  .ghSlotUneq{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;border:1px solid #5a2a34;
    background:#2a1520;color:#ff8a8a;font-size:10px;font-weight:700;cursor:pointer;display:flex;align-items:center;
    justify-content:center;padding:0;font-family:inherit;line-height:1;z-index:2}
  .ghSlotUneq:hover{background:#401828;border-color:#ff5060}

  /* ---- item action buttons (equip/sell) on cargo rows ---- */
  .ghItemBtn{padding:3px 8px;border-radius:6px;border:1px solid #2a3a52;background:#16202f;color:#e8edf4;
    font-family:inherit;font-size:9px;font-weight:700;cursor:pointer;letter-spacing:.4px;flex:none}
  .ghItemBtn:hover{background:#1e2b3e}
  .ghItemBtn.eq{border-color:#1c5a54;color:#dffdf8}
  .ghItemBtn.eq:hover{background:#1c5a54}
  .ghItemBtn.sl{border-color:#5a5a2a;color:#ffd27a}
  .ghItemBtn.sl:hover{background:#3a3a18}

  /* ---- sell all ore confirm tooltip ---- */
  .ghSellAllTip{font-size:10px;color:#7bd88f;text-align:center;padding:2px 0}

  /* ---- fleet drone stat bars ---- */
  .flStatRow{display:flex;align-items:center;gap:6px;font-size:10px;padding:1px 0}
  .flStatLbl{flex:none;width:32px;color:#7f8ea6;font-weight:700;font-size:9px;letter-spacing:.4px}
  .flStatVal{flex:none;width:40px;text-align:right;font-weight:700;font-size:10px}

  /* ---- store error/success toast flash ---- */
  .ghToastErr{color:#ff5060;font-weight:700}

  /* ---- STATION BAY · store tab (DOM overlay; shown only while docked on STORE) ---- */
  #storePanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #storePanel.show{display:flex}
  #stHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #stHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #stBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #stBody .ghCol{flex:none}
  #stBody #stStockWrap{flex:1;min-height:120px}
  #stBody #stCargoWrap{flex:1;min-height:80px}
  #stStock{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;overflow:auto;min-height:0;align-content:start}
  #stCargo{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;overflow:auto;min-height:0;align-content:start}
  .stRow{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid #223047;border-radius:9px;
    background:#0e1626;font-size:12px}
  .stRow:hover{background:#132033}
  .stStat{font-size:10px;color:#9aa7b8;flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .stPrice{font-size:11px;font-weight:700;color:#ffd27a;flex:none}
  .stSellBtn{padding:5px 12px;border-radius:7px;border:1px solid #5a5a2a;background:#16202f;color:#ffd27a;
    font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px;flex:none}
  .stSellBtn:hover{background:#3a3a18}
  .stHomeBtn{padding:5px 12px;border-radius:7px;border:1px solid #2a5a34;background:#153020;color:#7bd88f;
    font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.5px}
  .stHomeBtn:hover{background:#1c4a30}
  .stHomeBtn.active{border-color:#3a8a50;background:#1c4a30}

  /* ---- STATION BAY · warp tab (DOM overlay; shown only while docked on WARP) ---- */
  #warpPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #warpPanel.show{display:flex}
  #wpHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #wpHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #wpBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #wpBody .ghCol{flex:none}
  #wpBody #wpListWrap{flex:1;min-height:120px}
  #wpList{display:flex;flex-direction:column;gap:6px;overflow:auto;min-height:0}
  .wpRow{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid #223047;border-radius:9px;
    background:#0e1626;font-size:12px}
  .wpRow:hover{background:#132033}
  .wpRow.current{border-color:#2c8b82;background:#0f2028}
  .wpStName{flex:1;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wpPlanet{font-size:10px;color:#7f8ea6;flex:none}
  .wpDist{font-size:10px;color:#9aa7b8;flex:none}
  .wpGateBadge{padding:3px 8px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.5px;flex:none}
  .wpGateBadge.built{background:#1a3a2a;border:1px solid #2a5a34;color:#7bd88f}
  .wpGateBadge.none{background:#1c2430;border:1px solid #2a3a52;color:#7f8ea6}
  .wpGateBadge.marked{background:#2a2418;border:1px solid #5a4a2a;color:#ffd27a}
  .wpSubHead{font-size:9px;font-weight:700;letter-spacing:1px;color:#7f8ea6;padding:8px 2px 2px;text-transform:uppercase}
  .wpRow.uncharted{border-style:dashed;border-color:#2a3346}
  .wpRow.uncharted .wpStName{color:#9aa7b8}
  .wpJumpBtn,.wpBuildBtn,.wpMarkBtn{padding:5px 12px;border-radius:7px;border:1px solid #2a3a52;background:#16202f;color:#e8edf4;
    font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.5px;flex:none}
  .wpJumpBtn{border-color:#1c5a54;color:#dffdf8}
  .wpJumpBtn:hover{background:#1c5a54}
  .wpJumpBtn:disabled{opacity:.45;cursor:default;background:#16202f}
  .wpBuildBtn{border-color:#5a5a2a;color:#ffd27a}
  .wpBuildBtn:hover{background:#3a3a18}
  .wpBuildBtn:disabled{opacity:.45;cursor:default;background:#16202f}
  .wpMarkBtn{border-color:#4a4270;color:#c9b8ff}
  .wpMarkBtn:hover{background:#241f3a}
  .wpMarkBtn.marked{border-color:#5a4a2a;color:#ffd27a;background:#221d10}
  .wpProgress{display:flex;gap:16px;font-size:11px;color:#7f8ea6;padding:4px 0}
  .wpProgress b{color:#e8edf4}

  /* ---- STATION BAY · ships tab (DOM overlay; shown only while docked on SHIPS) ---- */
  #shipsPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #shipsPanel.show{display:flex}
  #spHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #spHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #spBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #spList{display:flex;gap:12px;flex-wrap:wrap;align-content:start}
  .spCard{flex:1;min-width:230px;max-width:340px;border:1px solid #223047;border-radius:12px;background:#0e1626;
    padding:12px 14px;display:flex;flex-direction:column;gap:6px}
  .spCard.current{border-color:#2c8b82;box-shadow:inset 0 0 14px rgba(87,209,201,.18)}
  .spCard.locked{opacity:.75}
  .spTop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .spName{font-size:13px;font-weight:700;letter-spacing:.6px;color:#8fd0ff;flex:1}
  .spTier{padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.6px;border:1px solid}
  .spTier.t0{border-color:#2a3a52;color:#c7d2e0;background:#16202f}
  .spTier.t1{border-color:#2c8b82;color:#57d1c9;background:#0f2028}
  .spTier.t2{border-color:#8a6f1e;color:#ffd24a;background:#241d0c}
  .spCur{padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.6px;
    background:#1c5a54;border:1px solid #2c8b82;color:#dffdf8}
  .spFlavor{font-size:10.5px;color:#7f8ea6;line-height:1.4}
  .spStats{display:flex;flex-direction:column;gap:4px;margin:2px 0}
  .spPrice{font-size:12px;font-weight:700;color:#ffd27a}
  .spLock{font-size:10px;color:#ff8a8a;letter-spacing:.3px;line-height:1.4}
  .spBuy{margin-top:4px;align-self:flex-start}
  .spBuy:disabled{opacity:.45;cursor:default}
  @media (max-width:560px){ .spCard{max-width:none} }

  /* ---- STATION BAY · skills tab (DOM overlay; skill tree, shown while docked on SKILLS) ---- */
  #skillsPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#122036 0%,#0a1120 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #skillsPanel.show{display:flex}
  #skHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #223047;
    background:rgba(8,12,22,.6);flex-wrap:wrap}
  #skHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#8fd0ff;text-transform:uppercase}
  #skXpWrap{flex:1 0 140px;min-width:120px;max-width:280px;height:8px;border-radius:5px;background:#0e1626;border:1px solid #223047;overflow:hidden}
  #skXpFill{height:100%;width:0;background:linear-gradient(90deg,#2c8b82,#57d1c9)}
  #skBody{flex:1;display:flex;gap:12px;flex-wrap:wrap;align-content:start;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  .skCard{flex:1;min-width:225px;max-width:330px;border:1px solid #223047;border-radius:12px;background:#0e1626;
    padding:10px 12px;display:flex;flex-direction:column;gap:6px}
  .skCardHead{font-size:13px;font-weight:700;letter-spacing:.6px;display:flex;align-items:center;gap:7px}
  .skIcon{font-size:15px}
  .skPerk{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #1a2740;border-radius:8px;background:#0b1220}
  .skPerkInfo{flex:1;min-width:0}
  .skPerkName{font-size:11.5px;font-weight:700;color:#e8edf4}
  .skPerkDesc{font-size:9.5px;color:#7f8ea6;margin:1px 0 3px}
  .skPips{display:flex;gap:3px}
  .skPip{width:12px;height:6px;border-radius:2px;background:#22304a}
  .skBuy{width:30px;height:30px;flex:none;border-radius:8px;border:1px solid #2a3a52;background:#16202f;color:#7f8ea6;
    font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;line-height:1}
  .skBuy:hover:not(:disabled){background:#1e2b3e}
  .skBuy:disabled{opacity:.4;cursor:default}
  @media (max-width:560px){ .skCard{max-width:none} }

  /* ---- OUTPOST · FORTIFY tab (DOM overlay; shown only while docked at a player outpost) ---- */
  #fortifyPanel{position:fixed;inset:0;display:none;flex-direction:column;z-index:20;touch-action:none;
    background:radial-gradient(120% 90% at 50% 0%,#0e2a2a 0%,#0a1720 55%,#070a12 100%);
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #fortifyPanel.show{display:flex}
  #foHead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #1c4744;
    background:rgba(8,18,20,.6);flex-wrap:wrap}
  #foHead h1{font-size:14px;letter-spacing:2px;margin:0;color:#22cccc;text-transform:uppercase}
  #foBody{flex:1;display:flex;flex-direction:column;gap:12px;padding:12px 16px;overflow:auto;min-height:0;touch-action:pan-y}
  #foBody .ghCol{flex:none}
  #foBody #foInvWrap{flex:1;min-height:120px}
  /* hardpoint + berth slots share the compact loadout/cargo sizing (auto-fill 64px, content height) */
  #foSlots{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}
  #foStats{display:flex;flex-direction:column;gap:2px;margin-top:8px}
  #foDrones{display:flex;flex-direction:column;gap:8px}
  .foBerth{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid #1c4744;border-radius:9px;background:#0e1a1a}
  .foBerthTop{display:flex;align-items:center;gap:9px}
  .foBerthStats{font-size:10px;color:#7f8ea6;letter-spacing:.3px}
  .foBerthSlots{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}
  #foInv{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;
    padding-right:4px;align-content:start}

  /* ---- VICTORY overlay (EMPIRE ESTABLISHED — all 10 regions taken; GAME.renderVictoryPanel) ---- */
  #victoryPanel{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:40;
    /* scene_victory hero shot behind a dimming gradient (gradient layer sits on
       top of the image so the EMPIRE ESTABLISHED text stays readable) */
    background:radial-gradient(120% 120% at 50% 40%,rgba(10,32,34,.78) 0%,rgba(5,9,16,.86) 60%,rgba(3,5,10,.92) 100%),
      url(sprites/victory_scene.png) center/cover no-repeat,#05070d;
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    user-select:none;-webkit-user-select:none}
  #victoryPanel.show{display:flex}
  #vicBox{display:flex;flex-direction:column;align-items:center;gap:14px;padding:34px 44px;max-width:92vw;
    border:1px solid #1c5a54;border-radius:16px;background:rgba(8,16,20,.72);
    box-shadow:0 0 60px rgba(34,204,204,.18),inset 0 0 40px rgba(34,204,204,.05)}
  #vicTitle{font-size:22px;font-weight:700;letter-spacing:4px;color:#22cccc;text-align:center;
    text-shadow:0 0 18px rgba(34,204,204,.6)}
  #vicSub{font-size:12px;line-height:1.7;color:#9ab8c0;text-align:center;letter-spacing:.4px}
  #vicStats{display:flex;flex-direction:column;gap:6px;min-width:250px;margin:4px 0;
    border-top:1px solid #1c4744;border-bottom:1px solid #1c4744;padding:12px 6px}
  .vicRow{display:flex;justify-content:space-between;gap:24px;font-size:12px}
  .vicLbl{color:#7f8ea6;letter-spacing:.5px}
  .vicVal{font-weight:700;color:#dffdf8}
  #vicBtns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
  #vicBtns .ghBtn{padding:11px 18px;font-size:12px}
  #vicNewGame{border-color:#5a2a34;color:#ff8a8a}
  @media (max-width:480px){ #vicBox{padding:24px 20px} #vicTitle{font-size:17px} }

  /* ---- OPENING scene (intro cutscene; fades in/out for ~3s on a brand-new
     game, before the tutorial coach marks; GAME.showOpeningScene) ---- */
  #openingScene{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
    background:#05070d;opacity:0;pointer-events:none;transition:opacity .6s ease}
  #openingScene.show{opacity:1}
  #openingScene.show.fade{opacity:0}
  #openingSceneImg{width:100%;height:100%;object-fit:cover}

  /* ---- TUTORIAL coach marks (first-run contextual tips; GAME.renderTutorialDOM
     positions the panel near the UI element each tip explains) ---- */
  #tutPanel{position:fixed;display:none;z-index:15;max-width:min(300px,calc(100vw - 24px));
    background:rgba(10,16,26,.92);border:1px solid #57d1c9;border-radius:10px;padding:10px 12px;
    color:#e8edf4;font-family:ui-monospace,Menlo,Consolas,monospace;
    box-shadow:0 0 24px rgba(87,209,201,.25);user-select:none;-webkit-user-select:none;touch-action:manipulation}
  #tutPanel.show{display:block}
  #tutTag{font-size:10px;font-weight:700;letter-spacing:1.5px;color:#57d1c9;margin-bottom:6px}
  #tutText{font-size:11px;line-height:1.55;color:#c7d2e0}
  #tutBtns{display:flex;justify-content:space-between;gap:10px;margin-top:9px}
  #tutBtns .ghBtn{padding:7px 12px;font-size:10px}
  #tutSkip{border-color:#3a4a5e;color:#7f8ea6}
  #tutArrow{position:absolute;width:0;height:0;border:8px solid transparent;display:none}
  #tutArrow.up{display:block;top:-16px;border-bottom-color:#57d1c9}
  #tutArrow.down{display:block;bottom:-16px;border-top-color:#57d1c9}
  #tutArrow.edge-right{right:22px}
  #tutArrow.edge-left{left:22px}
  #tutArrow.edge-center{left:50%;margin-left:-8px}

  /* ---- MOBILE: scrollable tab header so tabs don't wrap and push content off-screen ---- */
  @media(max-width:600px){
    #loHead,#stHead,#drHead,#ftHead,#ctHead,#wpHead,#spHead,#foHead{
      flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;gap:6px;padding-right:10px}
    #loHead .ghSp,#stHead .ghSp,#drHead .ghSp,#ftHead .ghSp,#ctHead .ghSp,#wpHead .ghSp,#spHead .ghSp{display:none}
    #loHead h1,#stHead h1,#drHead h1,#ftHead h1,#ctHead h1,#wpHead h1,#spHead h1{font-size:12px;white-space:nowrap}
    /* Compact portrait on small phones — slots are in the grid below so no width constraint needed */
    #loPortrait{min-width:94px;max-width:120px}
    #loShipCanvas{width:90px !important;height:90px !important}
    .loArrow{padding:8px 5px;font-size:11px}
  }

  /* ---- DRAG-AND-DROP: ghost label following finger + drop-zone highlights ---- */
  #ddGhost{position:fixed;z-index:100;pointer-events:none;display:none;cursor:grabbing;
    background:#0e1626;border:2px solid #57d1c9;border-radius:10px;
    padding:4px 12px;color:#57d1c9;font-family:ui-monospace,Menlo,Consolas,monospace;
    font-size:11px;font-weight:700;white-space:nowrap;
    box-shadow:0 4px 20px rgba(87,209,201,.4);transform:translate(-50%,-130%)}
  /* Draggable affordance on desktop */
  .ghTile[data-inv],.ghTile[data-cargoIdx]{cursor:grab}
  .ghSlot.loSlot.filled{cursor:grab}
  .ghSlot.ddOver{border-color:#57d1c9 !important;border-style:solid !important;
    background:#0c1e30 !important;box-shadow:0 0 14px rgba(87,209,201,.55) !important}
  #loInvWrap.ddOver{border-color:#7bd88f !important;box-shadow:0 0 10px rgba(123,216,143,.3) !important}
  /* Cargo wrap acts as a sell target when a cargo/inventory item is dragged over it */
  #stStockWrap.ddOver{outline:2px dashed #ffd27a;outline-offset:-3px;background:rgba(255,210,122,.06)}
  /* Sell value shown directly on cargo tiles in the store */
  .ghTileSell{font-size:8px;color:#ffd27a;text-align:center;line-height:1.2}
  /* Sell All button + modal */
  .stSellAllBtn{margin-top:6px;width:100%;padding:6px 12px;border-radius:7px;border:1px solid #1c5a54;
    background:#0e1626;color:#57d1c9;font-family:inherit;font-size:11px;font-weight:700;
    cursor:pointer;letter-spacing:.5px}
  .stSellAllBtn:hover{background:#13343a}
  #sellAllModal{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;
    background:rgba(2,5,12,.66);font-family:inherit}
  #sellAllModal .saCard{width:340px;max-width:88vw;background:rgba(6,10,22,.98);border:1px solid #1c5a54;
    border-radius:12px;padding:18px 20px;box-shadow:0 0 26px rgba(87,209,201,.28);color:#e8edf4}
  #sellAllModal h3{margin:0 0 12px;color:#57d1c9;font-size:15px;letter-spacing:.5px;font-weight:700}
  #sellAllModal .saLbl{font-size:12px;color:#9aa7b8;margin-bottom:8px}
  #sellAllModal .saGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-bottom:12px}
  #sellAllModal label{display:flex;align-items:center;gap:7px;font-size:12px;color:#e8edf4;cursor:pointer}
  #sellAllModal input[type=checkbox]{appearance:none;-webkit-appearance:none;width:15px;height:15px;flex:none;
    border:1px solid #2a5a54;border-radius:4px;background:#0e1626;cursor:pointer;position:relative}
  #sellAllModal input[type=checkbox]:checked{background:#57d1c9;border-color:#57d1c9}
  #sellAllModal input[type=checkbox]:checked::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;
    border:solid #06131a;border-width:0 2px 2px 0;transform:rotate(45deg)}
  #sellAllModal .saDiv{border-top:1px solid #1c3a44;margin:4px 0 12px}
  #sellAllModal .saOre{margin-bottom:14px}
  #sellAllModal .saBtns{display:flex;justify-content:space-between;gap:10px}
  #sellAllModal button{padding:7px 14px;border-radius:7px;border:1px solid #2a3a52;background:#16202f;
    color:#e8edf4;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.5px}
  #sellAllModal .saCancel:hover{background:#22314a}
  #sellAllModal .saConfirm{border-color:#1c5a54;color:#57d1c9}
  #sellAllModal .saConfirm:hover{background:#13343a}
  #sellAllModal .saConfirm:disabled{opacity:.45;cursor:default}
</style>
</head>
<body>
<div id="stage"><canvas id="game"></canvas></div>

<!-- ===== STATION BAY · LOADOUT tab (DOM overlay; populated by GAME.renderLoadoutPanel) ===== -->
<div id="loadoutPanel">
  <div id="loHead">
    <h1>Station Bay · Loadout</h1>
    <span class="ghPill">◇ <b id="loCred">0</b> cr</span>
    <span class="ghPill">⛽ <b id="loFuel">0/0</b></span>
    <span class="ghSp"></span>
    <button class="ghTab on" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="fortify" style="display:none">⛨ Fortify</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn" id="loSaveBtn">SAVE</button>
    <button class="ghBtn" id="loNewGame" style="border-color:#5a2a34;color:#ff8a8a">NEW GAME</button>
    <button class="ghBtn go" id="loLaunch">Launch ▸</button>
  </div>
  <div id="loBody">
    <div class="ghCol" id="loShipCol">
      <h2>Hangar Bay · <span id="loPageLbl">1 / 1</span> — cycle ships &amp; drones · active modules become skills</h2>
      <div id="loShipRow">
        <button class="ghBtn loArrow" id="loPrev">◀</button>
        <div id="loPortrait">
          <canvas id="loShipCanvas" width="264" height="264"></canvas>
          <div id="loShipName">—</div>
          <div id="loShipSub"></div>
          <button class="ghBtn" id="loActiveBtn">SET ACTIVE</button>
        </div>
        <button class="ghBtn loArrow" id="loNext">▶</button>
      </div>
      <!-- Equipment / skill slots — full-width 3-col grid below the portrait -->
      <div id="loSlotsGrid"></div>
    </div>
    <div class="ghCol" id="loStatsWrap">
      <h2>Ship Systems — tap a slot to see what it's doing</h2>
      <div id="loStats"></div>
    </div>
    <div class="ghCol" id="loInvWrap">
      <h2>Cargo — tap an item to fit or sell</h2>
      <div id="loInv"></div>
    </div>
  </div>
</div>
<div id="ghModal"></div>
<div id="ddGhost"></div>

<!-- ===== STATION BAY · HANGAR tab (refine ore + build drones; GAME.renderDronePanel) ===== -->
<div id="dronePanel">
  <div id="drHead">
    <h1>Station Bay · Hangar</h1>
    <span class="ghPill">◇ <b id="drCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="fortify" style="display:none">⛨ Fortify</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab on" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="drUndock">Launch ▸</button>
  </div>
  <div id="drBody">
    <div class="ghCol">
      <h2>Refine Ore — 2 ore → 1 bar · odd ore stays raw</h2>
      <div class="drRow" id="drOres"></div>
      <div class="drRow" style="margin-top:8px">
        <button class="ghBtn go" id="drRefine">⚒ Refine All</button>
        <span class="drRow" id="drBars"></span>
      </div>
    </div>
    <div class="ghCol">
      <h2>Drone Works — build companions · <span id="drCap">owned 0/6</span></h2>
      <div id="drTiers"></div>
      <div class="drRow" style="margin-top:10px">
        <span class="ghSp"></span>
        <button class="ghBtn go" id="drBuild">⚒ BUILD</button>
      </div>
    </div>
    <div class="ghCol">
      <h2>Your Drones — modules edited in LOADOUT · salvage returns 50% parts + fitted modules</h2>
      <div id="drList"></div>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · FLEET tab (drone role assignment; GAME.renderFleetPanel) ===== -->
<div id="fleetPanel">
  <div id="ftHead">
    <h1>Station Bay · Fleet Command</h1>
    <span class="ghPill">◇ <b id="ftCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab on" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="ftLaunch">Launch ▸</button>
  </div>
  <div id="ftBody">
    <div class="ghCol">
      <h2>Wing Status</h2>
      <div id="ftSummary">—</div>
    </div>
    <div class="ghCol" id="ftListWrap">
      <h2>Drones — escort your ship, wait in the hangar, or run trade routes</h2>
      <div id="ftList"></div>
    </div>
    <div class="ghCol" id="ftConvoyWrap">
      <h2>Trade Run Management — bundle hangar drones into a convoy</h2>
      <div id="ftConvoy"></div>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · CONTRACTS tab (DOM overlay; populated by GAME.renderContractsPanel) ===== -->
<div id="contractsPanel">
  <div id="ctHead">
    <h1>Station Bay · Contracts</h1>
    <span class="ghPill">◇ <b id="ctCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab on" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="ctLaunch">Launch ▸</button>
  </div>
  <div id="ctBody">
    <div class="ghCol" id="ctActiveWrap">
      <h2>Active contract — turn in when complete</h2>
      <div id="ctActive"></div>
    </div>
    <div class="ghCol" id="ctListWrap">
      <h2>Available — one active contract at a time</h2>
      <div id="ctList"></div>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · STORE tab (DOM overlay; populated by GAME.renderStorePanel) ===== -->
<div id="storePanel">
  <div id="stHead">
    <h1>Station Bay · Store</h1>
    <span class="ghPill">◇ <b id="stCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab on" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="fortify" style="display:none">⛨ Fortify</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="stLaunch">Launch ▸</button>
  </div>
  <div id="stBody">
    <div class="ghCol" id="stStockWrap">
      <h2 id="stStockHead">Station Stock</h2>
      <div id="stStock"></div>
    </div>
    <div class="ghCol" id="stCargoWrap">
      <h2>Your Cargo — drag an item up to the FOR SALE card to sell</h2>
      <div id="stCargo"></div>
      <button id="stSellAllBtn" class="stSellAllBtn">Sell All…</button>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · WARP tab (DOM overlay; populated by GAME.renderWarpPanel) ===== -->
<div id="warpPanel">
  <div id="wpHead">
    <h1>Station Bay · Warp Network</h1>
    <span class="ghPill">◇ <b id="wpCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab on" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="wpLaunch">Launch ▸</button>
  </div>
  <div id="wpBody">
    <div class="ghCol" id="wpListWrap">
      <h2 id="wpListHead">Warp Destinations</h2>
      <div id="wpList"></div>
      <div class="wpProgress" id="wpProgress"></div>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · SHIPS tab (ship market; GAME.renderShipsPanel) ===== -->
<div id="shipsPanel">
  <div id="spHead">
    <h1>Station Bay · Ship Market</h1>
    <span class="ghPill">◇ <b id="spCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab on" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab" data-tab="skills">◆ Skills</button>
    <button class="ghBtn go" id="spLaunch">Launch ▸</button>
  </div>
  <div id="spBody">
    <div class="ghCol" id="spListWrap">
      <h2>Ship Market — bigger hulls for bigger jobs · your modules transfer on upgrade</h2>
      <div id="spList"></div>
    </div>
  </div>
</div>

<!-- ===== STATION BAY · SKILLS tab (skill tree; populated by GAME.renderSkillsPanel) ===== -->
<div id="skillsPanel">
  <div id="skHead">
    <h1>Station Bay · Skills</h1>
    <span class="ghPill">✦ Lv <b id="skLevel">1</b></span>
    <div id="skXpWrap"><div id="skXpFill"></div></div>
    <span class="ghPill">XP <b id="skXp">0/0</b></span>
    <span class="ghPill" id="skPtsPill">◆ <b id="skPts">0</b> pts</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab" data-tab="warp">⌘ Warp</button>
    <button class="ghTab" data-tab="ships">⛭ Ships</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghTab" data-tab="fleet">▲ Fleet</button>
    <button class="ghTab" data-tab="contracts">✦ Jobs</button>
    <button class="ghTab on" data-tab="skills">◆ Skills</button>
    <button class="ghBtn" id="skRespec" style="border-color:#5a4a2a;color:#ffd27a">Respec ✦ 10000cr</button>
    <button class="ghBtn go" id="skLaunch">Launch ▸</button>
  </div>
  <div id="skBody"></div>
</div>

<!-- ===== OUTPOST · FORTIFY tab (DOM overlay; populated by GAME.renderFortifyPanel) ===== -->
<div id="fortifyPanel">
  <div id="foHead">
    <h1>Outpost · Fortify</h1>
    <span class="ghPill" id="foName" style="color:#22cccc"></span>
    <span class="ghPill">◇ <b id="foCred">0</b> cr</span>
    <span class="ghSp"></span>
    <button class="ghTab" data-tab="loadout">⚙ Loadout</button>
    <button class="ghTab" data-tab="store">☰ Store</button>
    <button class="ghTab on" data-tab="fortify">⛨ Fortify</button>
    <button class="ghTab" data-tab="drones">◈ Hangar</button>
    <button class="ghBtn go" id="foLaunch">Launch ▸</button>
  </div>
  <div id="foBody">
    <div class="ghCol">
      <h2>Module Slots — 4 hardpoints reinforce shields, armor, hull &amp; turret</h2>
      <div id="foSlots"></div>
      <div id="foStats"></div>
    </div>
    <div class="ghCol">
      <h2>Stationed Drones — 3 berths · launch when enemies close within 800u</h2>
      <div id="foDrones"></div>
    </div>
    <div class="ghCol" id="foInvWrap">
      <h2>Cargo — tap an item to fit or sell</h2>
      <div id="foInv"></div>
    </div>
  </div>
</div>

<!-- ===== TUTORIAL coach mark (first-run contextual tips; GAME.renderTutorialDOM) ===== -->
<div id="tutPanel">
  <div id="tutArrow"></div>
  <div id="tutTag"></div>
  <div id="tutText"></div>
  <div id="tutBtns">
    <button class="ghBtn" id="tutSkip">SKIP</button>
    <button class="ghBtn go" id="tutNext">NEXT ▸</button>
  </div>
</div>

<!-- ===== OPENING scene (intro cutscene; GAME.showOpeningScene on a brand-new game) ===== -->
<div id="openingScene"><img id="openingSceneImg" alt=""></div>

<!-- ===== VICTORY overlay (all 10 political regions player-controlled; GAME.renderVictoryPanel) ===== -->
<div id="victoryPanel">
  <div id="vicBox">
    <div id="vicTitle">⬡ EMPIRE ESTABLISHED ⬡</div>
    <div id="vicSub">You have united the solar system under your banner.<br>All factions have fallen. The void is yours.</div>
    <div id="vicStats"></div>
    <div id="vicBtns">
      <button class="ghBtn go" id="vicContinue">CONTINUE EXPLORING</button>
      <button class="ghBtn" id="vicNewGame">NEW GAME</button>
    </div>
  </div>
</div>

<script>
"use strict";
/*=== HARNESS:CODE:BEGIN ===*/
"""

TAIL = """</script>
</body>
</html>
"""


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read().rstrip() + "\n"


def build():
    parts = [HEAD]
    # ---- inlined Forge modules ----
    parts.append("/*=== HARNESS:MODULES ===*/\n/*=== HARNESS:MODULES:BEGIN ===*/\n")
    for m in MODULES:
        p = os.path.join(SRC, "modules", m + ".js")
        if not os.path.exists(p):
            sys.exit("missing module: " + p)
        parts.append("/* ---- forge/modules/%s.js ---- */\n" % m)
        parts.append(read(p))
    parts.append("/*=== HARNESS:MODULES:END ===*/\n")
    # ---- game code ----
    for gf in GAME_FILES:
        p = os.path.join(SRC, gf)
        if not os.path.exists(p):
            sys.exit("missing game file: " + p)
        parts.append(read(p))
    parts.append(TAIL)
    out = "".join(parts)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(out)
    kb = len(out.encode("utf-8")) / 1024.0
    print("built %s  (%d modules + %d game files, %.0f KB)" % (OUT, len(MODULES), len(GAME_FILES), kb))
    return out


def check():
    """Run the compiled game.html's selfTest headless in Node (proves the single
    file works exactly as shipped)."""
    runner = r"""
    const fs = require('fs');
    globalThis.__HARNESS_HEADLESS__ = true;
    const html = fs.readFileSync(process.argv[1], 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) { console.error('no <script> found'); process.exit(1); }
    // eval the shipped script exactly as the browser would run it (headless)
    (0, eval)(m[1]);
    const forge = ['ForgeItemSystem','ForgeEquipment','ForgeHUD',
                   'ForgeWorld','ForgeStore','ForgeCombat','ForgeFaction','ForgeNPC'];
    let bad = 0;
    for (const g of forge) {
      if (!globalThis[g]) { console.log('MISSING  ' + g); bad++; continue; }
      // faction/npc fire through ForgeCombat (85% hit) — seed a hitting rng for a stable status readout
      if (g === 'ForgeFaction' || g === 'ForgeNPC') globalThis.ForgeCombat.initCombat({ rng: () => 0.1 });
      const f = globalThis[g].selfTest();
      const ok = Array.isArray(f) && f.length === 0;
      console.log((ok ? 'GREEN ' : 'FAIL  ') + g + (ok ? '' : ' ' + JSON.stringify(f)));
      if (!ok) bad++;
    }
    globalThis.ForgeCombat.initCombat();
    const ok = globalThis.GAME.selfTest();
    console.log(ok === true ? 'GREEN  GAME.selfTest' : 'FAIL   GAME.selfTest');
    if (ok !== true) bad++;
    const skf = globalThis.GAME.skillsSelfTest ? globalThis.GAME.skillsSelfTest() : ['skillsSelfTest missing'];
    const skok = Array.isArray(skf) && skf.length === 0;
    console.log((skok ? 'GREEN  ' : 'FAIL   ') + 'GAME.skillsSelfTest' + (skok ? '' : ' ' + JSON.stringify(skf)));
    if (!skok) bad++;
    const trf = globalThis.GAME.tradeRoutesSelfTest ? globalThis.GAME.tradeRoutesSelfTest() : ['tradeRoutesSelfTest missing'];
    const trok = Array.isArray(trf) && trf.length === 0;
    console.log((trok ? 'GREEN  ' : 'FAIL   ') + 'GAME.tradeRoutesSelfTest' + (trok ? '' : ' ' + JSON.stringify(trf)));
    if (!trok) bad++;
    console.log(bad ? ('SELFTEST FAILED (' + bad + ')') : 'ALL GREEN');
    process.exit(bad ? 1 : 0);
    """
    r = subprocess.run(["node", "-e", runner, OUT], cwd=ROOT)
    return r.returncode


if __name__ == "__main__":
    build()
    if "--check" in sys.argv:
        sys.exit(check())
