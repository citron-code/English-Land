# English Land Agent Team

This project is a browser-based Babylon.js game for kindergarten English classes. Keep changes small, visually verifiable, and compatible with the dependency-free static server.

## Team Roles

### Island Architect

- Owns island lifecycle, descriptors, terrain configuration, exits, spawning, and disposal.
- First milestone: extract an `IslandInstance` boundary from `js/world.js` without changing the current single-island experience.
- Protects the player-facing `groundAt` and `resolve` contract while the active island changes.

### Learning Designer

- Owns vocabulary activities, readable feedback, progression, accessibility, and age-appropriate interaction.
- Keeps each island focused on one language theme and one repeatable play loop.
- Reviews camera readability and classroom usability before adding visual complexity.

### QA and Performance Engineer

- Owns browser checks, collision coverage, input recovery, deterministic captures, and performance budgets.
- Verifies desktop and tablet-sized viewports, including resize, blur, visibility changes, and touch orbit.
- Repeats checks after every island or shared-world change.

## Working Order

1. Inspect the owning abstraction and nearby verification path before editing.
2. Make the smallest reversible change in one ownership area.
3. Run a focused browser or code check immediately after the edit.
4. Review the rendered scene, then run the broader regression checklist.
5. Keep island content data-driven; avoid copying `world.js` for every new island.

## Island Roadmap

1. Add an island descriptor for the existing base camp.
2. Give each island an instance root, local collision registry, update list, spawn, and `dispose()` method.
3. Add an active-island facade so `player.js` does not know about transitions.
4. Add one transition trigger and one second island before considering streaming.
5. Add seeded decoration, oriented collisions, and visibility/input recovery as shared infrastructure.

## Definition Of Done

- Existing base camp still loads and renders without console errors.
- Player movement, jumping, collisions, emotes, and camera controls still work.
- The new island can be entered and left without leaked meshes, listeners, or collision records.
- A focused verification is documented or automated for every new interaction.
- Mobile/tablet behavior and low-end performance are considered before release.