# English Land — working notes

A low-poly 3D game in the spirit of Animal Crossing, built with **Babylon.js**.
Used by the owner for **kindergarten English classes**, so the character and
props are deliberately bright, friendly and readable from the back of a room.

## Running it

There is **no Node on this machine** and no build step. Babylon is vendored in
`lib/`. Serve the folder with the bundled dependency-free server:

```bash
powershell -ExecutionPolicy Bypass -File "tools\serve.ps1" -Port 5173
```

Then open <http://localhost:5173/>. Click the canvas so it has keyboard focus.

`serve.ps1` also accepts `POST /save?name=foo` with a PNG data URL body and
writes `tools/shots/foo.png`. That is how screenshots get out of the browser.
`tools/shots/` is gitignored.

## Controls

`WASD`/arrows move (camera-relative), `Shift` runs, `Space` jumps.
Emotes: `Z` wave, `X` thumbs up, `C` clap, `V` yes, `Q` no, `E` think.

## Layout

| File | Role |
| --- | --- |
| `js/character.js` | Procedural villager. All proportions/colours in `DEFAULTS`. |
| `js/props.js` | Prop builders. Each registers its own collision. |
| `js/world.js` | Island, painted ground texture, water, sky, camp layout, collision queries, animation of dynamic props. |
| `js/animation.js` | Idle + walk + jump poses, and the emote overlay layer. |
| `js/emotes.js` | Emote pose table; keybindings are derived from it. |
| `js/player.js` | Input, movement, collision resolution, jump physics. |
| `js/main.js` | Bootstrap, camera, render loop, `window.EL` dev hook. |

## How to verify changes

**Always look at the render — do not assume it worked.** The browser pane is
usually hidden, so the render loop is paused and screenshots via the normal
tooling fail. Instead drive it from the page:

```js
EL.capture(alpha, beta, radiusMul, targetY, w, h, focus)  // -> {png, cam}
EL.rest()                    // neutral pose, disables the player
EL.player.update(1/60)       // step the sim manually (loop is paused)
EL.world.update(1/60)
```

POST the returned `png` to `/save?name=...` and read the file. `EL.capture`
sets `capturing = true` so the render observer does not re-aim the camera.

To test movement, dispatch real `KeyboardEvent`s and step `player.update`
manually. After setting `camera.alpha` directly, call
`camera.getViewMatrix(true)` and `camera.computeWorldMatrix(true)` or
"forward" will be stale.

## Conventions

- The character faces **+Z**. Camera `alpha = -PI/2` is behind it.
- Arm rotations: `rotation.x` negative swings forward/up. `rotation.z`
  negative is outward for the LEFT arm, positive for the RIGHT.
- Babylon composes Euler rotation as **Y * X * Z**.
- Island top surface is `y = 0`. The rig's `groundOffset` is the root Y that
  rests the soles on it.
- Static props are merged by material at the end of `createWorld` (~32 draw
  calls). Anything that animates must go in `kit.dynamic`, never `kit.meshes`.

## Gotchas already paid for — do not re-learn these

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
  overhead shots and looks exactly like holes in the mesh.
- Coplanar surfaces z-fight: the island rim top and the ground plane, and the
  torso cap spheres against the body cylinder rim.
- A platform's standing footprint must be **wider** than its side-blocking
  radius, or there is a dead band where the block has cleared but you cannot
  land yet, and jumping onto props becomes impossible.
- Velocity is cancelled only against permanently solid things. Cancelling it
  against a platform scrubs off forward speed on the face while rising.
- Colliders spaced closer than the sum of their radii fight each other and
  squeeze the player through. `resolve()` runs two passes for this reason.

## Style

The owner reviews visually and gives direct feedback ("this looks trash",
"too high"). Take it at face value, find the actual root cause rather than
tweaking numbers, and say plainly what was wrong.
