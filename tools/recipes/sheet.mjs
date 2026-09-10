/*
 * Character model sheet: hides the world, poses the rig at rest, and composes a
 * labelled turnaround into one PNG that can be held next to reference art.
 *
 *   node tools/shot.mjs tools/recipes/sheet.mjs http://127.0.0.1:5173/ tools/shots
 *
 * Framing is derived from the rig's MEASURED silhouette, not from
 * `char.height`: that figure is taken once at build time, and one frame of idle
 * animation is enough to make it disagree with what actually renders.
 */
const SHEET = `(async () => {
  const B = BABYLON, S = EL.scene;

  const keep = new Set(EL.char.meshes);
  S.meshes.forEach(m => { if (!keep.has(m)) m.setEnabled(false); });
  if (EL.char.contact) EL.char.contact.setEnabled(false);
  S.fogMode = B.Scene.FOGMODE_NONE;
  S.clearColor = new B.Color4(0.898, 0.898, 0.898, 1);
  // flat studio light, so the silhouette reads rather than the island's mood
  S.lights.forEach(l => l.setEnabled(false));
  const hemi = new B.HemisphericLight('sheetHemi', new B.Vector3(0.2, 1, -0.25), S);
  hemi.intensity = 0.92;
  hemi.groundColor = new B.Color3(0.62, 0.62, 0.66);
  const key = new B.DirectionalLight('sheetKey', new B.Vector3(-0.45, -0.85, 0.55), S);
  key.intensity = 0.55;

  EL.rest();
  EL.char.root.position.set(0, EL.char.groundOffset, 0);
  EL.char.root.rotation.y = 0;
  // the play camera clamps radius; leave it in place and every close-up comes
  // out at the same useless distance
  EL.camera.lowerRadiusLimit = null;
  EL.camera.upperRadiusLimit = null;
  S.render();

  let lo = 1e9, hi = -1e9;
  EL.char.meshes.forEach(m => {
    m.refreshBoundingInfo();
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    lo = Math.min(lo, b.minimumWorld.y); hi = Math.max(hi, b.maximumWorld.y);
  });
  const SPAN = hi - lo;
  const HEADY = EL.char.headPivot.getAbsolutePosition().y;
  const HH = EL.char.height;                  // what EL.capture divides by
  const ty = (worldY) => worldY / HH;
  const rm = (worldR) => worldR / HH;

  const views = __VIEWS__.map(v => Object.assign({}, v, {
    ty: v.kind === 'head' ? ty(HEADY - EL.char.cfg.head.r * 0.34)
      : v.kind === 'feet' ? ty(lo + SPAN * 0.105)
      : ty(lo + SPAN * 0.5),
    r: rm(SPAN * v.zoom)
  }));

  const load = (src) => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  const imgs = [];
  for (const v of views) {
    const png = EL.capture(v.a, v.b, v.r, v.ty, v.w, v.h, null).png;
    imgs.push({ label: v.label, img: await load(png), w: v.w, h: v.h });
  }

  const cols = __COLS__, pad = 10, labelH = 26;
  const cw = Math.max(...imgs.map(i => i.w)), ch = Math.max(...imgs.map(i => i.h));
  const rows = Math.ceil(imgs.length / cols);
  const cv = document.createElement('canvas');
  cv.width  = cols * (cw + pad) + pad;
  cv.height = rows * (ch + pad + labelH) + pad + 22;
  const g = cv.getContext('2d');
  g.fillStyle = '#e5e5e5'; g.fillRect(0, 0, cv.width, cv.height);
  imgs.forEach((it, i) => {
    const cx = pad + (i % cols) * (cw + pad);
    const cy = pad + Math.floor(i / cols) * (ch + pad + labelH);
    g.fillStyle = '#2b2b2b';
    g.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(it.label, cx + cw / 2, cy + 18);
    g.drawImage(it.img, cx + (cw - it.w) / 2, cy + labelH);
    g.strokeStyle = 'rgba(0,0,0,.18)';
    g.strokeRect(cx + (cw - it.w) / 2 + .5, cy + labelH + .5, it.w - 1, it.h - 1);
  });
  g.textAlign = 'left';
  g.fillStyle = '#555';
  g.font = '13px ui-monospace, monospace';
  g.fillText('measured height ' + SPAN.toFixed(4) +
             '   char.height ' + HH.toFixed(4) +
             '   head centre ' + ((HEADY - lo) / SPAN).toFixed(3) + ' H',
             pad + 2, cv.height - 8);
  return { png: cv.toDataURL('image/png'), span: SPAN, charHeight: HH };
})()`;

const A = Math.PI / 2;              // +PI/2 looks at the character's face
const TURN = [
  { label: 'FRONT',      kind: 'body', a: A,        b: 1.5708, zoom: 1.55, w: 400, h: 620 },
  { label: 'BACK',       kind: 'body', a: -A,       b: 1.5708, zoom: 1.55, w: 400, h: 620 },
  { label: 'LEFT SIDE',  kind: 'body', a: 0,        b: 1.5708, zoom: 1.55, w: 400, h: 620 },
  { label: 'RIGHT SIDE', kind: 'body', a: Math.PI,  b: 1.5708, zoom: 1.55, w: 400, h: 620 },
  { label: 'FACE',       kind: 'head', a: A,        b: 1.5708, zoom: 0.62, w: 400, h: 440 },
  { label: 'FACE 3/4',   kind: 'head', a: A - 0.66, b: 1.5708, zoom: 0.62, w: 400, h: 440 },
  { label: 'HEAD BACK',  kind: 'head', a: -A,       b: 1.5708, zoom: 0.62, w: 400, h: 440 },
  { label: 'HEAD TOP',   kind: 'head', a: A,        b: 0.26,   zoom: 0.68, w: 400, h: 440 },
  { label: 'FEET',       kind: 'feet', a: A - 0.7,  b: 1.32,   zoom: 0.86, w: 400, h: 440 },
  { label: 'FEET SIDE',  kind: 'feet', a: 0,        b: 1.48,   zoom: 0.86, w: 400, h: 440 }
];

export default async function (api) {
  const name = process.env.SHEET_NAME || 'sheet';
  const out = await api.evaluate(
    SHEET.replace('__VIEWS__', JSON.stringify(TURN)).replace('__COLS__', '4'));
  console.log('measured height', out.span.toFixed(4), ' char.height', out.charHeight.toFixed(4));
  console.log(api.savePng(name, out.png));
}
