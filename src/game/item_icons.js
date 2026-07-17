/*=== HARNESS:ITEM_ICONS =====================================================*/
// Per-type procedural icon placeholders for the DOM menus (gear list, equip
// slots, store, item modals). Each item TYPE gets its own distinct glyph so a
// Missile Pod always shows the missile icon, a Shield Boost the shield-up icon,
// etc. — consistent across every menu screen. These are inline SVG placeholders
// meant to be swapped for real sprites later: to replace one, drop a PNG and
// return an <img> from itemIconSVG(), or point a key at assets/icon_<key>.png.

// item → icon key. Weapons key off weapon.type; everything else off base/cat.
function itemIconKey(item) {
  if (!item) return "misc";
  if (item.weapon && item.weapon.type) return item.weapon.type;   // laser | cannon | missile
  const map = {
    shield_extender: "shield_boost", shield_hardener: "shield_harden",
    shield_regen_module: "shield_repair", shield_booster: "shield_repair",
    armor_plate: "armor_boost", armor_coating: "armor_harden",
    armor_repair_module: "armor_repair", armor_repairer: "armor_repair",
    hull_plating: "armor_boost", hull_repair_kit: "armor_repair", hull_repair_module: "armor_repair",
    engine_booster: "engine", afterburner: "engine",
    fuel_cell: "fuel", fuel_regulator: "fuel", fuel_cell_module: "fuel",
    tractor_range: "tractor", tractor_slots: "tractor", tractor_lock: "tractor",
    tractor_drag: "tractor", tractor_capacity: "tractor", tractor_beam_upgrade: "tractor",
    solar_wing: "solar",
    ore_scanner: "scanner", survey_scanner: "scanner", mining_laser: "scanner", nav_computer: "scanner",
    cargo_expander: "cargo", ore_refinery: "cargo",
    turret: "cannon", mine_layer: "missile",
  };
  if (map[item.base]) return map[item.base];
  if (item.cat === "shield") return "shield_boost";
  if (item.cat === "armor" || item.cat === "hull") return "armor_boost";
  if (item.skill) return "shield_repair";
  return "misc";
}

// Human label for an icon key (tooltip / alt text).
const ITEM_ICON_LABEL = {
  laser: "Laser", cannon: "Cannon", missile: "Missile",
  shield_boost: "Shield Boost", shield_repair: "Shield Repair", shield_harden: "Shield Hardener",
  armor_boost: "Armor Boost", armor_repair: "Armor Repair", armor_harden: "Armor Hardener",
  engine: "Engine", fuel: "Fuel", tractor: "Tractor", solar: "Solar",
  scanner: "Scanner", cargo: "Cargo", misc: "Module",
};

// Inner SVG markup per icon key. currentColor is set by the caller (category
// tint), so glyphs read on a dark tile. Solid weapons, outlined utilities.
const ITEM_ICON_GLYPH = {
  // ── weapons (solid) ──
  laser: '<circle cx="5" cy="12" r="2.6" fill="currentColor"/><path d="M8 12h13M12.5 8.6h7M12.5 15.4h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  cannon: '<rect x="3" y="9.2" width="12" height="5.6" rx="1.2" fill="currentColor"/><rect x="14.5" y="8" width="4.5" height="8" rx="1.2" fill="currentColor"/><circle cx="6" cy="12" r="1.1" fill="#0e1626"/>',
  missile: '<path d="M4 12l6-2.6h6l4 2.6-4 2.6h-6z" fill="currentColor"/><path d="M20 12l-4-2.6v5.2z" fill="currentColor"/><path d="M6 9.4l-2-2.4 3 2.6zM6 14.6l-2 2.4 3-2.6z" fill="currentColor"/>',
  // ── shields (outlined shield silhouette + modifier) ──
  shield_boost: '<path d="M12 3.2l7 2.6v4.8c0 4.8-3 7.7-7 9.4-4-1.7-7-4.6-7-9.4V5.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.6 13l3.4-3.4 3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  shield_repair: '<path d="M12 3.2l7 2.6v4.8c0 4.8-3 7.7-7 9.4-4-1.7-7-4.6-7-9.4V5.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8.4v5.6M9.2 11.2h5.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  shield_harden: '<path d="M12 3.2l7 2.6v4.8c0 4.8-3 7.7-7 9.4-4-1.7-7-4.6-7-9.4V5.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.4 9.6l7 5M15.6 9.6l-7 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  // ── armor (scale/chevron plates + modifier) ──
  armor_boost: '<path d="M4 10l8-4 8 4M4 15l8-4 8 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 6.5l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  armor_repair: '<path d="M4 11l8-4 8 4M4 16l8-4 8 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3v4M10 5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  armor_harden: '<path d="M4 11l8-4 8 4M4 16l8-4 8 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 4l5 3M14.5 4l-5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  // ── utility / propulsion (outlined) ──
  engine: '<path d="M9 4h6l-1.5 9h-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.5 13.5c0 2 1.5 4 1.5 5.5 0-1.5 1.5-3.5 1.5-5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  fuel: '<path d="M12 3.5c3.6 4.6 5 6.6 5 9.5a5 5 0 0 1-10 0c0-2.9 1.4-4.9 5-9.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 13a2.5 2.5 0 0 0 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  tractor: '<path d="M7 5v6a5 5 0 0 0 10 0V5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 5h3v6M17 5h-3v6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18" r="1.4" fill="currentColor"/>',
  solar: '<circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  scanner: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 12l6.2-3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="8.5" r="1.2" fill="currentColor"/>',
  cargo: '<path d="M12 3.5l8 4v9l-8 4-8-4v-9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 7.5l8 4 8-4M12 11.5V20" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  misc: '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
};

// itemIconSVG(keyOrItem) → inline SVG string sized to fill its tile.
function itemIconSVG(keyOrItem) {
  const key = (typeof keyOrItem === "string") ? keyOrItem : itemIconKey(keyOrItem);
  const glyph = ITEM_ICON_GLYPH[key] || ITEM_ICON_GLYPH.misc;
  return '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block;padding:15%;box-sizing:border-box" '
    + 'role="img" aria-label="' + (ITEM_ICON_LABEL[key] || "Module") + '">' + glyph + '</svg>';
}
