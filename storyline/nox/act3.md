# Nox Covenant — Act 3  (STUB)
## Resolution — what the player does about it

Not yet written. Target: **15–20 quest nodes**, ~3 hours of play.

## Node table

| # | Node | Territory / target | Scenes | Gameplay objective | Unlocks |
|---|---|---|---|---|---|
| 3.01 | | | | | |

## Notes
- Quest nodes must hook `src/game/quests.js` — the extension point is the `kind`
  switch (`godo` / `chain` / `multi` today) in `questObjectiveDone`,
  `questProgressText` and `_questObjectivePoint`. A story node is a new `kind`
  that bypasses the random station board.
- Targets are territory-scoped through the lineage layer, never raw geometry.
- Anything persistent must be whitelisted in `serializeGame`/`applySaveData`
  (`src/game/save.js`) or it will not survive a reload.
