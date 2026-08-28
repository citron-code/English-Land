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
| `js/world.js` | Square grass platform, lighting rig, shadow generator |
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
