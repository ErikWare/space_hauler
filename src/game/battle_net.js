/*=== HARNESS:BATTLE_NET =====================================================*/
// Game Center / online PVP stub. Phase 5 will bridge GameKit matchmaking and
// host-authoritative input sync. Local builds always report offline.
const BATTLE_NET = {
  available: false,
  reason: "Game Center PVP not wired yet (Phase 5)",
};

Object.assign(GAME, {
  battleNetStatus() {
    return { available: BATTLE_NET.available, reason: BATTLE_NET.reason };
  },
  // Future: startGameCenterMatch(snapshot) → exchange CombatSnapshot, then
  // startBattleMatch with opponent.kind = "human".
  startOnlineBattle() {
    toast("Online PVP — coming soon (Game Center)", "#9ab8e0", 3);
    sfx("warn");
    return { ok: false, reason: BATTLE_NET.reason };
  },
});
