# English Land — working notes

A low-poly 3D game in the spirit of Animal Crossing, built with **Babylon.js**.
Used by the owner for **kindergarten English classes**, so the character and
props are deliberately bright, friendly and readable from the back of a room.

## Running it

No build step. Babylon is vendored in `lib/`. Serve the folder with the bundled
dependency-free server:

```bash
powershell -ExecutionPolicy Bypass -File "tools\serve.ps1" -Port 5173
```

Then open <http://localhost:5173/>. Click the canvas so it has keyboard focus.
The server sends `Cache-Control: no-store`, so a plain reload always picks up
an edit.

**Node is available on this machine** (v24 at the time of writing) and the
capture tooling below uses it. There is still no npm install: everything is
built on Node's own globals.

## Controls

`WASD`/arrows move (camera-relative), `Shift` runs, `Space` jumps.
Emotes: `Z` wave, `X` thumbs up, `C` clap, `V` yes, `Q` no, `E` think.

## Layout

| File | Role |
| --- | --- |
| `js/character.js` | Procedural villager. All proportions/colours in `DEFAULTS`. |
| `js/props.js` | Prop builders. Each registers its own collision. |
| `js/terrain.js` | Height field the island ground is built from. |
| `js/world.js` | Island, painted ground texture, water, sky, camp layout, collision queries, animation of dynamic props. |
| `js/animation.js` | Idle + walk + jump poses, and the emote overlay layer. |
| `js/emotes.js` | Emote pose table; keybindings are derived from it. |
| `js/player.js` | Input, movement, collision resolution, jump physics. |
| `js/main.js` | Bootstrap, camera, render loop, `window.EL` dev hook. |
| `tools/serve.ps1` | Static server, no Node needed. |
| `tools/shot.mjs` | Headless Chrome capture driver over the DevTools protocol. |
| `tools/recipes/` | Recipes the driver runs. `sheet.mjs`, `measure.mjs`. |

## How to verify changes

**Always look at the render — do not assume it worked.** With the server up:

```bash
node tools/shot.mjs tools/recipes/sheet.mjs http://127.0.0.1:5173/ tools/shots
node tools/shot.mjs tools/recipes/measure.mjs
```

`sheet.mjs` writes one labelled turnaround PNG — front, back, both sides, face,
face 3/4, head back, head top, feet — that can be held next to reference art.
`measure.mjs` prints the silhouette in pixels under an orthographic camera, as
fractions of total height, next to the reference numbers. **Measure before
arguing about proportions.** Every proportion problem found so far was invisible
to the eye and obvious in the table.

A recipe is a module exporting a default async function that gets
`{ evaluate, capture, shot, savePng, send, sleep, consoleLog, OUT }`. Write a
throwaway recipe for anything specific — an emote sheet, a close-up of one
joint, a movement smoke test. That is cheaper than squinting at the game.

`tools/shots/` is gitignored.

Driving the page by hand from a console still works:

```js
EL.capture(alpha, beta, radiusMul, targetY, w, h, focus)  // -> {png, cam}
EL.rest()                    // neutral pose, disables the player
EL.pose(phase, speed)        // hold a walk pose
EL.player.update(1/60)       // step the sim manually
EL.world.update(1/60)
```

To test movement, dispatch real `KeyboardEvent`s and step `player.update`
manually. After setting `camera.alpha` directly, call `camera.getViewMatrix(true)`
and `camera.computeWorldMatrix(true)` or "forward" will be stale.

## Conventions

- The character faces **+Z**. Camera `alpha = -PI/2` is behind it, `+PI/2` is
  looking at its face.
- Arm rotations: `rotation.x` negative swings forward/up. `rotation.z`
  negative is outward for the LEFT arm, positive for the RIGHT.
- Babylon composes Euler rotation as **Y * X * Z**.
- Island top surface is `y = 0`. The rig's `groundOffset` is the root Y that
  rests the soles on it.
- Face feature heights are fractions of the **head radius** (`yR`), so the whole
  face survives a change of head size.
- `headBase` carries the character's constant chin lift; `headPivot` belongs to
  the animator, which writes its rotation outright every frame.
- Static props are merged by material at the end of `createWorld` (~32 draw
  calls). Anything that animates must go in `kit.dynamic`, never `kit.meshes`.

## Gotchas already paid for — do not re-learn these

### Babylon

- `camera.setTarget()` **preserves camera position** and back-solves
  alpha/beta/radius. On a follow camera that drags the view overhead. Write
  `camera.target.copyFrom(...)` instead.
- `DynamicTexture` defaults to **CLAMP**, unlike `Texture`. Left clamped, a
  tiled texture renders as flat colour.
- `opacityTexture` reads **luminance**, not alpha. A black-with-alpha gradient
  is uniformly transparent and draws nothing.
- `autoCalcShadowZBounds` fits the depth range to the **casters only**, so the
  ground a shadow lands on falls outside it and the shadow is clipped away.
  Set `shadowMinZ`/`shadowMaxZ` by hand.
- Shadow darkness competes with ambient. With hemi at ~0.6, darkness must be
  near 0 to read at all.
- Blur-exponential shadows washed out entirely at this scale. PCF is stable.
- Default `camera.minZ` is 1.0, which slices the top off the model on close or
  overhead shots and looks exactly like holes in the mesh. A **negative** minZ
  on an orthographic camera is worse: the projection goes degenerate and
  nothing draws at all.
- `refreshBoundingInfo()` rebuilds a mesh's LOCAL box; only a following
  `computeWorldMatrix(true)` re-projects it into world space. Calling them the
  other way round silently reports stale bounds. Vertex displacement and
  `convertToFlatShadedMesh()` both invalidate the builder's bounds, which is how
  `char.height` came out 3% short — and `main.js` sizes the whole follow camera
  off that number.
- `CreateDisc` is wound to face **-Z**. With back-face culling on it is simply
  invisible from the front; `DOUBLESIDE` fixes that, but then the face you see
  is the back one and its texture is **mirrored in u**.
- `CreateTorus` is already built lying in the XZ plane. Rotating it 90° about X
  stands it on edge — which is how the shoe's "ankle collar" became a hoop
  running up the shin, and most of why the shoe measured two thirds too tall.

### Modelling

- Coplanar surfaces z-fight: the island rim top and the ground plane, and the
  torso cap spheres against the body cylinder rim.
- A feature sunk into the head deeper than its own half-depth disappears
  **inside** it. The brows vanished this way.
- A flat decal on a curved head gets one edge shaved off by the surface unless
  it is laid along the **surface normal**. An eye with its top shaved reads as
  half-closed, and the character looks like it is staring at the floor.
- Rings stacked forward along a feature's own axis drift sideways on screen once
  that feature is yawed. Above about 20° they stop looking concentric and the
  character reads as cross-eyed. Paint them into a texture instead.
- To spin a mesh about its own axis **and** pitch it, use two nodes. Both angles
  on one node compose as Y*X*Z and the "spin" swings the whole part sideways.
- Sleeves need the shirt to have a real shoulder. Against a straight-sided
  torso, the sleeve's own hemispherical cap is the only shoulder there is, and
  it silhouettes against the background as a ball bolted to the side.
- Brows angled down toward the nose read as a scowl, every time.

### Collision and movement

- A platform's standing footprint must be **wider** than its side-blocking
  radius, or there is a dead band where the block has cleared but you cannot
  land yet, and jumping onto props becomes impossible.
- Velocity is cancelled only against permanently solid things. Cancelling it
  against a platform scrubs off forward speed on the face while rising.
- Colliders spaced closer than the sum of their radii fight each other and
  squeeze the player through. `resolve()` runs two passes for this reason.
- `player.js` carries a fixed collision radius (0.34) that is **not** derived
  from the mesh. The character is now slimmer than it, so the player stops
  slightly short of props. Deliberate for now; change it as a gameplay call,
  not a modelling one.

### Capture

- The play camera clamps `lowerRadiusLimit`. Leave it in place and every
  close-up comes out at the same useless distance.
- `scene.onBeforeRenderObservable` re-aims the camera at the player and
  re-plants the rig on the terrain every frame. Clear it before measuring, or
  the first render undoes whatever the recipe just set up.
- Headless Chrome renders through SwiftShader, so FPS from a capture run means
  nothing. Measure performance in a real browser.

## Style

The owner reviews visually and gives direct feedback ("this looks trash",
"too high", "the eyes are still not right"). Take it at face value, find the
actual root cause rather than tweaking numbers, and say plainly what was wrong.
When a judgement call is close, render two or three variants side by side and
choose from the picture — guessing has been the expensive path every time.
