# English Land

A low-poly 3D game with the vibes of an Animal Crossing-style life sim, built with
[Babylon.js](https://www.babylonjs.com/). This repo currently holds the **mechanics
demo** we're building up step by step.

## Run it

No build step. Serve the folder and open it:

```bash
powershell -ExecutionPolicy Bypass -File "tools\serve.ps1" -Port 5173
```

Then <http://localhost:5173/>. Click the canvas so it has keyboard focus.

## Layout

| Path | What |
| --- | --- |
| `index.html` | Page shell + on-screen HUD |
| `js/character.js` | Procedural low-poly villager built from Babylon primitives. All proportions and colours live in `DEFAULTS`. |
| `js/props.js` | Prop library - trees, house, playground, pool, fences, flowers |
| `js/terrain.js` | Height field the island ground is built from |
| `js/world.js` | The island: painted ground, water, lighting, camp layout, collision |
| `js/emotes.js` | Emote pose table (one entry per emote) |
| `js/animation.js` | Procedural idle + walk cycle, plus the emote layer |
| `js/player.js` | Input, camera-relative movement, platform clamping |
| `js/main.js` | Bootstrap, camera, render loop, dev capture hook |
| `lib/babylon.js` | Vendored Babylon.js (UMD build) so the demo is self-contained |
| `tools/serve.ps1` | Dependency-free static server (no Node needed) |
| `tools/shot.mjs` | Headless capture driver (Node, no npm packages) |
| `tools/recipes/` | Recipes the driver runs - turnaround sheet, silhouette measurement |

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move (relative to the camera) |
| `Shift` | Run |
| `Space` | Jump |
| Drag | Orbit the camera |
| Scroll | Zoom |

### Emotes

| Key | Emote |
| --- | --- |
| `Z` | Wave (hello / goodbye) |
| `X` | Thumbs up (good job) |
| `C` | Clap (well done) |
| `V` | Nod - yes |
| `Q` | Shake - no |
| `E` | Think (hand on chin) |

Emotes are defined in `js/emotes.js` as a target pose for a given progress
`u` (0..1). The animator lerps the rig toward those targets by an eased
envelope, so an emote layers over whatever the character is already doing
rather than replacing it. To add one, add an entry to the `EMOTES` table with
a `key` - the keybinding map is built from the table itself.

## The character

Proportions are measured against a reference turnaround rather than eyeballed.
As fractions of total height: shoes 10%, trousers 22%, shirt 27.5%, neck 3.5%,
head plus hair 36.5%. Widths matter as much as heights - the figure reads wrong
the moment it gets barrel-chested.

A few pieces are built the way they are for specific reasons:

| Part | How, and why |
| --- | --- |
| Skull | A plain sphere. The head reads as taller than it is wide, but that extra height is hair piled on the crown - a stretched skull would break the face placement, the ear seats and the concentric hair shell all at once. |
| Hair | A faceted shell concentric with the skull, so it can never lift off it. The fringe is a sawtooth locked to the sphere's own vertex columns, so every point is exactly one triangle and they all come out the same size. |
| Eyes | One textured disc each, laid flat along the head's surface normal. Rings painted into a texture stay concentric from any angle; rings stacked as separate meshes drift apart once the eye is yawed out onto the cheek. |
| Shirt | Carries its own shoulder. The sleeve then grows out of it, instead of its hemispherical cap silhouetting as a ball bolted to a straight-sided torso. |
| Head pose | `headBase` holds a constant chin lift so the character meets the camera; `headPivot` is left free for the animator, which rewrites it every frame. |

Face feature heights are given as fractions of the head radius, so the whole
face survives a change of head size.

## Tweaking the character

`createCharacter(scene, overrides)` deep-merges an overrides object onto the
defaults, e.g.

```js
createCharacter(scene, {
  head:   { r: 0.224, tiltDeg: 6 },
  face:   { eye: { r: 0.048 }, brow: { on: true } },
  colors: { shirt: '#ffd166', hair: '#3a2a1a' }
});
```

## Checking a change

With the server running:

```bash
node tools/shot.mjs tools/recipes/sheet.mjs http://127.0.0.1:5173/ tools/shots
node tools/shot.mjs tools/recipes/measure.mjs
```

The first writes a labelled turnaround PNG to `tools/shots/`. The second prints
the silhouette in pixels, as fractions of total height, alongside the reference
numbers. Both drive headless Chrome over the DevTools protocol using nothing but
Node's own globals.

## Steps so far

1. **Character design** - procedural low-poly villager: faceted black hair with
   a sawtooth fringe, round textured eyes, white shirt and black tie, black
   trousers, black high-top sneakers, hoop earrings.
2. **Platform, movement and walk cycle** - a square grass island, camera-relative
   WASD movement with acceleration and shortest-arc turning, and a procedural
   walk cycle whose phase advances with *distance travelled* so the feet stay in
   step at any speed and never skate.
3. **Idle life and jumping** - blinking, glancing around, weight shifts and an
   occasional stretch, each on its own irregular timer so they never sync up.
   Jump has coyote time, an input buffer, air control, a landing squash, and a
   contact shadow that tightens and fades with height.
4. **Emotes** - six, on `Z X C V Q E`.
5. **The base camp island** - house, garden, playground, pool, paths, and a
   ring of trees on a round island in open water.
6. **Polish** - butterflies, drifting clouds, a gradient sky dome, a pier with a
   moored boat, shore foam, and a lot more prop detail.
7. **Terrain and layout** - a height field under the island, a river and
   waterfall, and a reshuffled camp.
8. **Villager rebuild** - proportions measured against the reference, the hair
   and eyes rebuilt, and a capture harness so the render is checked rather than
   assumed.

## Animated things

Most props are static and get merged, but a few are deliberately left out of
the merge and driven from `world.update(dt)`:

| Thing | Motion |
| --- | --- |
| Butterflies | Wander on summed sines; heading is taken by sampling the same curve slightly ahead, so they always face their travel. Wings beat independently of drift speed. |
| Clouds | Slow drift, wrapping around the sky |
| Campfire | Flame flicker and rotation |
| Water | Scrolling wave texture and a gentle swell |
| Pool | Slight surface bob |

## The island

The ground is a single mesh with one painted 1024-square texture holding the
grass, checker, sand beach, dirt patches and every path. Painting the paths
costs no geometry and no draw calls, and the layout can be rearranged without
touching a mesh. The island's round silhouette is an alpha cutout in that same
texture rather than custom geometry.

Props are static, so they are merged by material after placement - a few
hundred small meshes become about 30 draw calls.

### Collision

`world.js` exposes two queries that `player.js` drives:

| Query | Meaning |
| --- | --- |
| `groundAt(x, z, y)` | height of the surface under a point |
| `resolve(x, z, y, r, out)` | push a circle out of anything solid |

Props register as either **solid** (trees, house, fences, table - these always
block) or **platform** (crates, stumps, benches, sandbox rim, pool edge, slide
steps - these only block while you are *below* their top, so you can jump onto
them and stand there).

Two details make jumping onto things feel right. A platform's standing
footprint is inflated by more than its side-blocking radius, otherwise there is
a dead band where you have cleared the block but cannot land yet. And velocity
is only cancelled against permanently solid things - cancelling it against a
platform scrubs off your forward speed on the face while you rise, and you can
never get on top.

The player's collision radius is a fixed 0.34 and is not derived from the mesh.
The villager is now slimmer than that, so the player stops a little short of
props. That is a gameplay number, not a modelling one.
