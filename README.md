# English Land

A low-poly 3D game with the vibes of an Animal Crossing-style life sim, built with
[Babylon.js](https://www.babylonjs.com/). This repo currently holds the **mechanics
demo** we're building up step by step.

## Run it

No build step, no server needed. Open `index.html` in a modern browser
(Chrome/Edge/Firefox), or serve the folder statically.

## Layout

| Path | What |
| --- | --- |
| `index.html` | Page shell + on-screen HUD |
| `js/character.js` | Procedural low-poly villager built from Babylon primitives. All proportions and colours live in `DEFAULTS`. |
| `js/props.js` | Prop library - trees, house, playground, pool, fences, flowers |
| `js/world.js` | The island: painted ground, water, lighting, camp layout, collision |
| `js/emotes.js` | Emote pose table (one entry per emote) |
| `js/animation.js` | Procedural idle + walk cycle, plus the emote layer |
| `js/player.js` | Input, camera-relative movement, platform clamping |
| `js/main.js` | Bootstrap, camera, render loop, dev capture hook |
| `lib/babylon.js` | Vendored Babylon.js (UMD build) so the demo is self-contained |
| `tools/serve.ps1` | Dependency-free static server (no Node needed) |

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

## Tweaking the character

`createCharacter(scene, overrides)` deep-merges an overrides object onto the
defaults, e.g.

```js
createCharacter(scene, {
  head:   { r: 0.50 },
  colors: { shirt: '#ffd166', hair: '#3a2a1a' }
});
```

## Steps so far

1. **Character design** - procedural low-poly villager (black messy hair, white
   shirt + black tie, black trousers, black high-top sneakers, hoop earrings).
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
