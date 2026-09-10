/*
 * Pixel-exact silhouette measurement, under an ORTHOGRAPHIC camera so the
 * numbers can be compared straight against ratios read off reference art.
 * Every figure is a fraction of the character's total height.
 *
 *   node tools/shot.mjs tools/recipes/measure.mjs http://127.0.0.1:5173/
 *
 * Reference turnaround, for comparison (fraction of total height):
 *   head+hair  h 0.365  w 0.330      shirt body w 0.209
 *   torso      h 0.275               sleeve     w 0.062
 *   legs       h 0.220               trouser    w 0.066
 *   shoes      h 0.099               shoe       w 0.101
 */
const CODE = `(() => {
  const B = BABYLON, S = EL.scene, C = EL.char, cam = EL.camera,
        cv = EL.engine.getRenderingCanvas();

  S.meshes.forEach(m => { if (!C.meshes.includes(m)) m.setEnabled(false); });
  if (C.contact) C.contact.setEnabled(false);
  S.fogMode = B.Scene.FOGMODE_NONE;
  S.clearColor = new B.Color4(0, 0, 0, 1);
  S.lights.forEach(l => l.setEnabled(false));
  const flat = new B.HemisphericLight('flat', new B.Vector3(0, 1, 0), S);
  flat.intensity = 1.0;
  // every part painted pure white, so the silhouette is unambiguous
  const white = new B.StandardMaterial('mm', S);
  white.emissiveColor = new B.Color3(1, 1, 1);
  white.disableLighting = true;
  const orig = new Map();
  C.meshes.forEach(m => { orig.set(m, m.material); m.material = white; });

  EL.rest();
  C.root.position.set(0, C.groundOffset, 0);
  C.root.rotation.y = 0;

  const W = 700, HPX = 900, SPAN = 2.2;             // SPAN world units top to bottom
  cv.style.width = W + 'px'; cv.style.height = HPX + 'px';
  EL.engine.setSize(W, HPX);
  cam.detachControl();
  cam.lowerRadiusLimit = null; cam.upperRadiusLimit = null;
  cam.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
  const aspect = W / HPX;
  cam.orthoTop = SPAN / 2; cam.orthoBottom = -SPAN / 2;
  cam.orthoLeft = -SPAN * aspect / 2; cam.orthoRight = SPAN * aspect / 2;
  // a negative minZ makes the ortho projection degenerate and nothing draws
  cam.minZ = 0.1; cam.maxZ = 100;
  // the render observer re-aims the camera at the player every frame
  S.onBeforeRenderObservable.clear();

  const scratch = document.createElement('canvas');
  scratch.width = W; scratch.height = HPX;
  const g = scratch.getContext('2d', { willReadFrequently: true });

  const aim = (alpha, cy) => {
    cam.target.copyFrom(new B.Vector3(0, cy, 0));
    cam.alpha = alpha; cam.beta = Math.PI / 2; cam.radius = 8;
    cam.getViewMatrix(true); cam.computeWorldMatrix(true);
  };

  /* pixel bbox of whatever is currently enabled, in world units */
  const bbox = () => {
    S.render(); S.render();
    g.clearRect(0, 0, W, HPX);
    g.drawImage(cv, 0, 0, W, HPX);
    const d = g.getImageData(0, 0, W, HPX).data;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let y = 0; y < HPX; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4] > 90) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    const u = SPAN / HPX;                 // world units per pixel
    return { w: (x1 - x0 + 1) * u, h: (y1 - y0 + 1) * u,
             top: (HPX / 2 - y0) * u, bot: (HPX / 2 - y1 - 1) * u };
  };

  const bucket = (n) =>
    /^(head$|hair|eye|brow|nose|mouth|ear)/.test(n) ? 'head' :
    /^(torso|collar|tie)/.test(n)                   ? 'torso' :
    /^(shoulder|sleeve|cuff|hand|thumb)/.test(n)    ? 'arm' :
    /^(pant|hem)/.test(n)                           ? 'leg' :
    /^shoe/.test(n)                                 ? 'shoe' :
    /^neck/.test(n)                                 ? 'neck' : 'other';

  const groups = {};
  C.meshes.forEach(m => (groups[bucket(m.name)] ||= []).push(m));

  aim(Math.PI / 2, C.groundOffset + 0.7);
  const all = bbox();
  const H = all.h, ground = all.bot;
  const f = (v) => +(v / H).toFixed(3);

  const res = { _H: +H.toFixed(4), TOTAL: { h: 1, w: f(all.w) } };
  for (const k of Object.keys(groups)) {
    C.meshes.forEach(m => m.setEnabled(groups[k].includes(m)));
    const b = bbox();
    if (b) res[k] = { h: f(b.h), w: f(b.w), top: f(b.top - ground), bot: f(b.bot - ground) };
  }
  C.meshes.forEach(m => m.setEnabled(true));

  aim(0, C.groundOffset + 0.7);
  res._sideDepth = f(bbox().w);

  const solo = (nm) => {
    const m = C.meshes.find(x => x.name === nm); if (!m) return null;
    C.meshes.forEach(x => x.setEnabled(x === m));
    aim(Math.PI / 2, C.groundOffset + 0.7);
    const b = bbox(); C.meshes.forEach(x => x.setEnabled(true));
    return b ? { w: f(b.w), h: f(b.h), top: f(b.top - ground), bot: f(b.bot - ground) } : null;
  };
  res._parts = {};
  for (const nm of ['torsoBody', 'sleeveL', 'handL', 'pantL', 'shoeUpperL', 'head', 'hair'])
    res._parts[nm] = solo(nm);

  C.meshes.forEach(m => { m.material = orig.get(m); });
  return res;
})()`;

export default async function (api) {
  console.log(JSON.stringify(await api.evaluate(CODE), null, 1));
}
