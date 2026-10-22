# Gwent Classic: behaviour parity checklist

The original browser-side implementation (`gwent.js`, `abilities.js`, `factions.js`, `cards.js`, `decks.js`) remains the **reference specification** while Go becomes the authoritative game engine. Passing CI is not proof of full 1:1 parity.

## Verified in Go regression tests

- **Independent JS-to-Go scoring oracle**: 384 seeded, checked-in row states evaluated by the unmodified `gwent.js` `Row.calcCardScore` method in Node. `node scripts/score-goldens.mjs --check` verifies the fixtures against the JS source, and `TestScoreParityWithOriginalJavaScript` compares individual Go unit strengths with JS for weather, King Bran, double-spy, tight bond, morale, hero, and Horn combinations. This covers **row scoring only**, not whole games or animation timing.
- **Independent Scorch transition oracle**: 120 seeded board states execute actual original `abilities.js` callbacks and `Row.calcCardScore` / `maxUnits` / `scorch` / `updateState` methods. `node scripts/scorch-goldens.mjs --check` verifies the fixtures; `TestScorchTransitionsMatchOriginalJavaScript` compares both players' row contents, graveyards and resulting scores for special/global-unit/close/ranged/siege Scorch, weather, heroes, bonds, morale, horns and ties. The adapter replaces DOM/audio and card-zone storage only; this is one resolved effect per fixture, not whole-game replay.
- **`Row.calcCardScore` ordering**: base strength → weather (minimum, including King Bran's floor-half) → double spies → tight bond → morale → Commander's Horn. A 256-case modifier matrix and targeted cases check exact strengths.
- Heroes do not receive weather, bond, morale or horn modifiers; Decoy is a zero-point placeholder, not a Scorch target and not a valid Decoy target.
- **`Game.endRound` initiative**: winner opens the following round; on a draw, the previous opening player retains initiative. Nilfgaard tie-breaker is applied before selecting winner.
- **`Weather.addCard` lifecycle**: physical weather cards persist on the shared row; duplicates of the same card go to the playing owner's grave; Clear Weather / leader clear moves active weather to the appropriate owners' graves. Weather card art and row effects are shown by the new React client.
- **Skellige** third-round revivals are processed after BOTH previous-round boards and weather have cleared, so revived spies cannot be immediately deleted by the opposing player’s cleanup.
- **Scorch** destroys zero-power units if they are the strongest eligible targets, including Cow and its Avenger replacement.
- **Muster** summons all matching prefix cards, including `Arachas- Behemoth`, with their own triggered abilities; **Ermion** applies Mardroeme to existing and subsequent Berserkers.
- **Emhyr White Flame** disables both active and passive leader abilities, including King Bran.
- Francesca Hope uses the original exhaustive agile-row placement search for up to 18 agile cards (larger malicious/custom states use bounded greedy fallback).
- CI exercises every playable original card definition with a legal Go action against the mandatory checked-in catalogue (this is a smoke sweep, not a golden-state parity proof).
- The server retains immutable round score history for the original win/loss screen, and deck-choice projections are sorted so a client never learns the shuffled draw order.
- **End-of-match board cleanup**: `Game.endRound` invokes `Board.clearRound` *even for the terminal round*. Go now records immutable results before clearing all ordinary/special/weather cards to their owner's graveyard, while honoring Monsters' end-of-round survivor and the Avenger removal trigger.
- **Removal-triggered Avenger**: replacing Cow or Kambi with Decoy returns that original unit to the player's hand AND still summons Bovine Defense Force / Hemdall, because the legacy `Row.removeCard` triggers the removal callback on all destinations.
- **Leader Horn's occupied-slot rule**: Foltest, Eredin and Francesca consume their active ability but do not double a row already occupied by *any* special card (including Mardroeme). An unblocked leader Horn appears in the temporary special slot in the client projection but never creates a physical card in the graveyard.
- **Dimun Pirate** now triggers global Scorch both when played and when revived, excluding its own source card as the original callback does.
- **Targeted Medic** supports either legal row for an agile target, including chained revivals. Invalid destinations leave the action unchanged. Invader resolves random Medic chains without manual selection; returning cards to a hand with Emhyr/Eredin still honors the selected target and rejects heroes/forged UIDs.
- **Special slots** reject Mardroeme as well as a second Horn after a leader Horn occupies the row.
- All 22 catalogue leaders have contract tests for legal active commands, passive activation rejection, one-use enforcement and private reconnaissance. Cerys + three bonded Shield Maidens and transformed Young Berserkers after Decoy/replay have real-catalogue interaction tests.
- Server-controlled mulligan, two-player state visibility, selected deck ownership, targeting of medics / leaders, and chained medic revivals have existing tests.

## Not yet demonstrated 1:1 (do not mark complete)

- Full 216-card catalogue exercised with deterministic action-by-action golden traces against the legacy JavaScript engine (in particular multi-effect interactions, Cerys/Shield Maidens, Skellige, special row cards and transformed unit edge cases).
- Random agile revivals (Invader / Skellige) still use the compatibility default Close row. Skellige round-start revival chains and explicit row selection during those automatic effects need a separate queued-choice state machine and reference traces; the new row picker covers explicitly targeted Medic actions.
- **AI**: the Go easy/normal/hard AI is *new* and intentionally not identical to the original weighted `ControllerAI` policy.
- Automatic passing of exhausted hands and passive-leader players is covered by targeted Go regression tests, including prevention of forced passing during mulligans and Medic chains. Leaders that search an empty grave/deck now consume their turn without inventing cards; bogus explicit targets remain invalid. Full action-by-action pass timing still requires reference replay tests.
- **Presentation** is intentionally redesigned. React + Motion renders a new Russian interface; original animation timing and pixel appearance are not goals of this prototype. Old runtime scripts are not shipped.
- Full action-by-action parity for every interaction still requires deterministic JS replay traces; passing legal-card and full-match tests is not an exhaustive equivalence proof.

## New prototype acceptance checks

- The embedded catalogue is checked against all original rule fields and IDs; Russian names, ability descriptions, unique stable keys and artwork must exist.
- 45 complete Go matches exercise five factions × three bot difficulties × three styles. These use actual shuffled decks; they test legal progress and termination, not deterministic reference parity.
- Private draw contents and all intermediate animation frames are checked for hidden-zone leaks.
- A placement destroyed by a subsequent bot action remains present in the event history, and normal round cleanup does not masquerade as Scorch destruction.
- WebSocket integration tests cover timeout broadcast to both seats when `sync` first observes the deadline.
- Playwright runs the actual production client: deck editing/leader/import/export/persistence, a complete bot match, two isolated PvP sessions with concurrent readiness, offline/reconnect/reload, tied-round lives, animation/resync, touch inspection and layouts at desktop/tablet/phone sizes. A separate scenario checks custom bot settings and the two-stage Eredin discard/draw choice.
- Two further browser cases use controlled snapshots to check initial/chained agile revival row selection and the submitted `targetRow`. They supplement real-server Go regression tests; they are not end-to-end server parity tests.
- Vitest checks deck documents, legacy migration, copy limits, legal UI destinations and Russian plurals.

## Acceptance for 1:1

1. A deterministic JS reference harness that drives the legacy engine without DOM latency, with fixed shuffles and AI randomness, and a matching Go replay runner.
2. Golden traces for each of the 216 definitions and every leader/faction; diff card zones, scores, statuses and turn ownership **after every action**.
3. Two-browser real-time end-to-end suite: creation, selecting/saving decks, playing with bots at each difficulty, joining/refetching/restarting, passing/round transitions, abilities, and expiration.
4. Broader visual regression baselines and ability-specific browser scenarios for the redesigned client. Original pixel parity is outside the redesign scope.

Run tests: `go test -race ./... && go vet ./...`, `node scripts/score-goldens.mjs --check && node scripts/scorch-goldens.mjs --check`, then `cd web && npm test && npm run build && npm run test:e2e`.
