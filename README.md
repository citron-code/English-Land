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
| `index.html` | Page shell + on-screen HUD / view buttons |
| `js/character.js` | Procedural low-poly villager, built from Babylon primitives. All proportions and colours live in `DEFAULTS`. |
| `js/main.js` | Scene: orbit camera, lighting, contact shadow, idle bob, view presets |
| `lib/babylon.js` | Vendored Babylon.js (UMD build) so the demo is self-contained |

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
