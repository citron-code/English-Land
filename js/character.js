/*
 * English Land - procedural low-poly villager
 * ---------------------------------------------------------------------------
 * Proportions follow the reference turnaround: head is ~42% of total height,
 * stubby limbs, no visible neck from the front, chunky faceted hair.
 *
 * BUILD RULE: every part is created in the LOCAL space of the pivot it will be
 * parented to (pivot-local origin = 0,0,0). Never build at world coordinates
 * and then parent - that double-applies the pivot transform.
 *
 * Body is smooth-shaded; hair is flat-shaded and vertex-displaced for the
 * faceted low-poly silhouette.
 *
 *     createCharacter(scene, { colors: { shirt: '#ffd166' } })
 *
 * Returns the rig (root, headPivot, torsoPivot, hipPivot, armL/R, legL/R) so
 * later steps can drive walk cycles and emotes.
 */
(function (global) {
  'use strict';

  const B = global.BABYLON;
  if (!B) { throw new Error('Babylon.js must be loaded before character.js'); }

  /* ----------------------------------------------------------------- helpers */
  const deg = (d) => d * Math.PI / 180;
  const V3  = (x, y, z) => new B.Vector3(x, y, z);
  const hex = (s) => B.Color3.FromHexString(s);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deepMerge(base, ext) {
    if (Array.isArray(base)) return Array.isArray(ext) ? ext.slice() : base.slice();
    const out = Object.assign({}, base);
    if (!ext) return out;
    for (const k of Object.keys(ext)) {
      const v = ext[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(base[k] || {}, v) : v;
    }
    return out;
  }

  // orient a mesh's local +Y axis along `dir`
  function orientYTo(mesh, dir) {
    const d = dir.normalizeToNew();
    const dot = Math.max(-1, Math.min(1, d.y));
    if (dot > 0.999999) { mesh.rotationQuaternion = B.Quaternion.Identity(); return; }
    if (dot < -0.999999) { mesh.rotationQuaternion = B.Quaternion.RotationAxis(B.Vector3.Right(), Math.PI); return; }
    const axis = B.Vector3.Cross(B.Vector3.Up(), d).normalize();
    mesh.rotationQuaternion = B.Quaternion.RotationAxis(axis, Math.acos(dot));
  }

  /* ---------------------------------------------------------------- defaults */
  /* All Y values are metres above the ground plane (soles rest exactly on 0). */
  /* Proportions traced from the reference turnaround (fractions of total
   * height): head+hair 39%, neck gap 5%, torso 25%, legs 23%, shoes 8%.
   * Total silhouette works out to roughly 1.72 units. */
  const DEFAULTS = {
    head:  { r: 0.245, y: 1.240, sx: 1.00, sy: 0.99, sz: 0.96 },
    neck:  { r: 0.088, y: 0.980, h: 0.09 },
    torso: { yTop: 0.985, yBot: 0.620, topR: 0.215, botR: 0.190, hemSquash: 0.38 },
    // len is tuned so the hands land at hip height, level with the shirt hem
    arm:   { r: 0.068, len: 0.302, xPivot: 0.216, yPivot: 0.912,
             outDeg: 8, fwdDeg: 3, shoulderMul: 1.85 },
    hand:  { r: 0.082 },
    hip:   { y: 0.620, x: 0.102 },
    leg:   { r: 0.082, len: 0.455 },
    shoe:  { w: 0.178, h: 0.165, d: 0.315, toeOut: 0.058, soleT: 0.062 },

    face: {
      eye:  { w: 0.092, h: 0.122, d: 0.062, x: 0.093, y: 0.024, inset: 0.016, tiltDeg: 4, yawDeg: 12 },
      brow: { w: 0.082, h: 0.018, d: 0.026, y: 0.112, tiltDeg: 8 },
      nose: { r: 0.031, h: 0.046, y: -0.038, thin: 0.55 },
      mouth:{ w: 0.090, lift: 0.021, y: -0.106, r: 0.0080 },
      ear:  { r: 0.050, xFactor: 0.955, y: -0.016 },
      earring: { d: 0.056, t: 0.012, drop: 0.070 }
    },

    /* The reference hair is a tall rounded mop: it clears the skull by roughly
     * 60% of the skull diameter, so the cap is stretched in Y rather than just
     * offset. Few, large facets - not many small spikes. */
    hair: {
      // volXZ > 1 so the mop sits wider than the skull at ear level, the way a
      // bowl cut actually hangs - a cap narrower than the head looks shrunken
      cap:    { rExtra: 0.032, slice: 0.60, up: 0.044, back: -0.016,
                tiltDeg: 6, segments: 8, volY: 1.26, volXZ: 1.10 },
      // Hairline arc: y is the height at the temples, dip lowers it centrally.
      // jag roughens that edge and rimJag roughens the rim all the way round,
      // which is what gives the bowl-cut its spiky low-poly outline.
      cut:    { y: 0.185, dip: 0.040, jag: 0.050, rimJag: 0.045, sideReach: 0.38 },
      jag:    { amount: 0.032, frontDamp: 0.40 },   // radial vertex displacement
      tufts:  { count: 8, len: [0.045, 0.090], r: [0.085, 0.145] },
      fringe: { count: 5, spreadDeg: 120, len: [0.060, 0.100], r: [0.055, 0.085], dropDeg: 74 },
      burns:  { len: 0.072, r: 0.055 },
      seed:   20260828
    },

    colors: {
      skin:   '#d59a6b',
      skinSh: '#c98a5c',
      hair:   '#191920',
      shirt:  '#f5f4f0',
      dark:   '#17171b',
      sole:   '#fbfbf7',
      eye:    '#2b1d13',
      spark:  '#f6f2ec',
      nose:   '#e08a4e',
      mouth:  '#7a4d3a',
      silver: '#c2c2c9'
    }
  };

  /* --------------------------------------------------------------- materials */
  function makeMaterials(scene, colors) {
    const mk = (name, colHex, spec, power) => {
      const m = new B.StandardMaterial(name, scene);
      m.diffuseColor = hex(colHex);
      m.specularColor = new B.Color3(spec, spec, spec);
      m.specularPower = power;
      return m;
    };
    return {
      skin:   mk('skin',   colors.skin,   0.05, 56),
      skinSh: mk('skinSh', colors.skinSh, 0.04, 48),
      hair:   mk('hair',   colors.hair,   0.20, 22),
      shirt:  mk('shirt',  colors.shirt,  0.06, 44),
      dark:   mk('dark',   colors.dark,   0.08, 44),
      sole:   mk('sole',   colors.sole,   0.06, 44),
      eye:    mk('eye',    colors.eye,    0.50, 110),
      spark:  mk('spark',  colors.spark,  0.65, 128),
      nose:   mk('nose',   colors.nose,   0.05, 44),
      mouth:  mk('mouth',  colors.mouth,  0.05, 44),
      silver: mk('silver', colors.silver, 0.75, 128)
    };
  }

  /* -------------------------------------------------------------------- hair
   * Built entirely in HEAD-LOCAL space: the head centre is the origin here.
   */
  function buildHair(scene, C, mats, rng) {
    const R = C.head.r, H = C.hair;
    const pieces = [];

    /* --- faceted cap: low-poly sphere slice, vertices pushed out randomly --- */
    const cap = B.MeshBuilder.CreateSphere('hairCap', {
      diameter: 2 * (R + H.cap.rExtra),
      segments: H.cap.segments,
      slice: H.cap.slice
    }, scene);

    const rr = R + H.cap.rExtra;
    const pos = cap.getVerticesData(B.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) {
      const v = V3(pos[i], pos[i + 1], pos[i + 2]);
      const len = v.length();
      if (len < 1e-5) continue;
      const n = v.scale(1 / len);
      // keep the forehead edge tidier, let the crown/back go jagged
      const front = Math.max(0, n.z);
      const damp  = 1 - front * (1 - H.jag.frontDamp);
      // vertices near the bottom rim stay put so the cap seats on the skull
      const rim   = Math.min(1, Math.max(0, (n.y + 0.15) / 0.5));
      const push  = (rng() - 0.25) * H.jag.amount * damp * rim;

      // radial jag, then stretch into the tall mop volume
      const x = n.x * (len + push) * H.cap.volXZ;
      let   y = n.y * (len + push) * H.cap.volY + H.cap.up;
      const z = n.z * (len + push) * H.cap.volXZ + H.cap.back;

      // Carve the hairline so the face stays clear. Front-facing vertices are
      // lifted onto an arc that dips toward the centre of the forehead; the
      // lift fades to nothing around the sides so the back stays covered.
      // Per-vertex noise on that height gives the edge its spiky outline.
      const t  = Math.min(1, Math.abs(x) / (rr * H.cap.volXZ));
      const hy = H.cut.y - (1 - t * t) * H.cut.dip + (rng() - 0.5) * H.cut.jag;
      // The lift has to reach round the temples too, not just the front: with a
      // front-only weight the sides hang low and cover the eye in profile.
      // Full lift facing forward, partial at the sides, none at the back.
      const lift = Math.min(1, Math.max(0, n.z + H.cut.sideReach));
      if (y < hy) y += (hy - y) * lift;

      // ...and rough up the rim all the way round, so the back and sides end
      // in points too rather than a clean machined circle
      const low = 1 - Math.min(1, Math.max(0, (n.y + 0.30) / 0.45));
      y -= rng() * H.cut.rimJag * low;

      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
    }
    cap.setVerticesData(B.VertexBuffer.PositionKind, pos);
    cap.rotation.x = -deg(H.cap.tiltDeg);
    cap.bakeCurrentTransformIntoVertices();     // so tufts can seat against it
    pieces.push(cap);

    // where the (now stretched) cap surface sits along a given direction
    const capSurface = (dir) => {
      const d = dir.normalizeToNew();
      return V3(d.x * rr * H.cap.volXZ,
                d.y * rr * H.cap.volY + H.cap.up,
                d.z * rr * H.cap.volXZ + H.cap.back);
    };

    /* ------------------------------------------- chunky tuft / spike helper */
    const addChunkAt = (seat, pointDir, len, baseR, sides, poke, jitter) => {
      const s = B.MeshBuilder.CreateCylinder('ht', {
        height: len, diameterBottom: baseR, diameterTop: baseR * 0.10, tessellation: sides
      }, scene);
      orientYTo(s, pointDir);
      if (jitter) {
        const ax = V3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
        s.rotationQuaternion = B.Quaternion.RotationAxis(ax, (rng() - 0.5) * jitter)
          .multiply(s.rotationQuaternion);
      }
      const dir = pointDir.normalizeToNew();
      s.position.copyFrom(seat.subtract(dir.scale(0.02)).add(dir.scale(len * 0.5 * poke)));
      pieces.push(s);
    };

    // seat a chunk against the dome along a radial direction
    const addChunk = (radialDir, pointDir, len, baseR, sides, poke, jitter) =>
      addChunkAt(capSurface(radialDir), pointDir, len, baseR, sides, poke, jitter);

    /* --- messy tufts over crown, sides and back (face kept clear) --- */
    for (let i = 0; i < H.tufts.count; i++) {
      const theta = rng() * Math.PI * 2;
      const elev  = deg(8 + rng() * 78);
      const dir = V3(
        Math.cos(elev) * Math.sin(theta),
        Math.sin(elev),
        Math.cos(elev) * Math.cos(theta)
      );
      if (dir.z > 0.40 && dir.y < 0.45) continue;      // don't grow over the face
      const len   = H.tufts.len[0] + rng() * (H.tufts.len[1] - H.tufts.len[0]);
      const baseR = H.tufts.r[0]   + rng() * (H.tufts.r[1]   - H.tufts.r[0]);
      // sweep the tips up and back so it reads as styled hair, not a hedgehog
      const point = dir.add(V3(0, 0.22, -0.30)).normalize();
      addChunk(dir, point, len, baseR, 4, 0.55, 0.45);
    }

    /* --- front fringe: strands seated ON the hairline, hanging down over the
     * forehead. Seating them on the arc (not the uncut dome) is what stops
     * them reading as fangs stuck to the middle of the face. --- */
    const spread = deg(H.fringe.spreadDeg);
    const rx = rr * H.cap.volXZ;
    for (let i = 0; i < H.fringe.count; i++) {
      const f = H.fringe.count === 1 ? 0.5 : i / (H.fringe.count - 1);
      const theta = -spread / 2 + f * spread;
      const x  = Math.sin(theta) * rx * 0.86;
      const t  = Math.min(1, Math.abs(x) / rx);
      const hy = H.cut.y - (1 - t * t) * H.cut.dip;
      const z  = Math.sqrt(Math.max(0.0001, rx * rx - x * x)) * 0.88 + H.cap.back;

      const len   = H.fringe.len[0] + rng() * (H.fringe.len[1] - H.fringe.len[0]);
      const baseR = H.fringe.r[0]   + rng() * (H.fringe.r[1]   - H.fringe.r[0]);
      const drop  = deg(H.fringe.dropDeg);
      const point = V3((x / rx) * 0.45, -Math.sin(drop), Math.cos(drop) * 0.80).normalize();
      addChunkAt(V3(x, hy + 0.025, z), point, len, baseR, 4, 0.75, 0.20);
    }

    /* --- sideburns: level with the ear, not forward of it, or they rake
     * across the face in profile --- */
    [-1, 1].forEach((side) => {
      const dir = V3(side * 0.97, 0.06, 0.06).normalize();
      addChunk(dir, V3(side * 0.28, -1, 0.06).normalize(), H.burns.len, H.burns.r, 4, 0.8, 0.1);
    });

    const hair = B.Mesh.MergeMeshes(pieces, true, true, undefined, false, false);
    hair.name = 'hair';
    hair.material = mats.hair;
    hair.convertToFlatShadedMesh();
    return hair;
  }

  /* --------------------------------------------------------------- assembly */
  function createCharacter(scene, overrides) {
    const C = deepMerge(DEFAULTS, overrides || {});
    const mats = makeMaterials(scene, C.colors);
    const rng = mulberry32(C.hair.seed);

    const root = new B.TransformNode('character', scene);

    const box = (n, w, h, d) => B.MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    const sph = (n, d, seg) => B.MeshBuilder.CreateSphere(n, { diameter: d, segments: seg || 18 }, scene);
    const cap = (n, r, len) => B.MeshBuilder.CreateCapsule(n, {
      radius: r, height: Math.max(len, 2 * r + 0.001), tessellation: 18, capSubdivisions: 8
    }, scene);
    const cyl = (n, dT, dB, h, t) => B.MeshBuilder.CreateCylinder(n, {
      diameterTop: dT, diameterBottom: dB, height: h, tessellation: t || 20
    }, scene);

    /* ------------------------------------------------------------ head rig */
    const headPivot = new B.TransformNode('headPivot', scene);
    headPivot.parent = root;
    headPivot.position.y = C.head.y;              // everything below is head-local

    const head = sph('head', C.head.r * 2, 24);
    head.scaling.set(C.head.sx, C.head.sy, C.head.sz);
    head.material = mats.skin;
    head.parent = headPivot;

    const R = C.head.r;
    // place a feature on the head surface; +push moves it outward
    const onFace = (x, y, push) => {
      const zz = Math.sqrt(Math.max(0.0001, R * R - x * x - y * y));
      return V3(x, y, zz * C.head.sz + (push || 0));
    };
    const F = C.face;

    /* eyes */
    const mkEye = (side) => {
      const g = new B.TransformNode('eye' + (side < 0 ? 'L' : 'R'), scene);
      g.parent = headPivot;
      g.position.copyFrom(onFace(side * F.eye.x, F.eye.y, -F.eye.inset));
      g.rotation.z = side * -deg(F.eye.tiltDeg);
      g.rotation.y = side * -deg(F.eye.yawDeg);

      const ball = sph('eyeBall' + (side < 0 ? 'L' : 'R'), 1, 16);
      ball.scaling.set(F.eye.w, F.eye.h, F.eye.d);
      ball.material = mats.eye;
      ball.parent = g;

      const spark = sph('eyeSpark' + (side < 0 ? 'L' : 'R'), 0.040, 8);
      spark.material = mats.spark;
      spark.position.set(side * -0.022, 0.036, F.eye.d * 0.5 + 0.003);
      spark.parent = g;
      return g;
    };
    const eyeL = mkEye(-1), eyeR = mkEye(1);

    /* brows - subtle, sit just under the fringe */
    [-1, 1].forEach((side) => {
      const br = box('brow' + (side < 0 ? 'L' : 'R'), F.brow.w, F.brow.h, F.brow.d);
      br.material = mats.hair;
      br.parent = headPivot;
      br.position.copyFrom(onFace(side * F.eye.x, F.brow.y, -0.030));
      br.rotation.z = side * deg(F.brow.tiltDeg);
      br.rotation.x = deg(-10);
    });

    /* nose - small orange triangle */
    const nose = cyl('nose', 0, F.nose.r * 2, F.nose.h, 3);
    nose.material = mats.nose;
    nose.scaling.z = F.nose.thin;
    nose.rotation.y = deg(30);
    nose.parent = headPivot;
    nose.position.copyFrom(onFace(0, F.nose.y, -0.006));

    /* mouth - gentle upward smile */
    const mpts = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14;
      mpts.push(V3((s - 0.5) * F.mouth.w,
                   Math.pow((s - 0.5) * 2, 2) * F.mouth.lift - F.mouth.lift * 0.5,
                   0));
    }
    const mouth = B.MeshBuilder.CreateTube('mouth', {
      path: mpts, radius: F.mouth.r, tessellation: 8, cap: B.Mesh.CAP_ALL
    }, scene);
    mouth.material = mats.mouth;
    mouth.parent = headPivot;
    mouth.position.copyFrom(onFace(0, F.mouth.y, -0.006));

    /* ears + hoop earrings */
    [-1, 1].forEach((side) => {
      const tag = side < 0 ? 'L' : 'R';
      const ear = sph('ear' + tag, F.ear.r * 2, 12);
      ear.scaling.set(0.55, 1, 0.85);
      ear.material = mats.skinSh;
      ear.parent = headPivot;
      ear.position.set(side * R * F.ear.xFactor, F.ear.y, 0);

      const ring = B.MeshBuilder.CreateTorus('earring' + tag, {
        diameter: F.earring.d, thickness: F.earring.t, tessellation: 16
      }, scene);
      ring.material = mats.silver;
      ring.rotation.x = Math.PI / 2;
      ring.parent = headPivot;
      ring.position.set(side * R * (F.ear.xFactor - 0.04), F.ear.y - F.earring.drop, 0.012);
    });

    /* hair - built in head-local space, so parenting is a plain assignment */
    const hair = buildHair(scene, C, mats, rng);
    hair.parent = headPivot;

    /* ---------------------------------------------------------------- neck */
    const neck = cyl('neck', C.neck.r * 2, C.neck.r * 2.15, C.neck.h, 16);
    neck.material = mats.skinSh;
    neck.parent = root;
    neck.position.y = C.neck.y;

    /* --------------------------------------------------------- torso/shirt */
    const T = C.torso;
    const tH = T.yTop - T.yBot;
    const torsoPivot = new B.TransformNode('torsoPivot', scene);
    torsoPivot.parent = root;

    const torsoBody = cyl('torsoBody', T.topR * 2, T.botR * 2, tH, 24);
    torsoBody.material = mats.shirt;
    torsoBody.parent = torsoPivot;
    torsoBody.position.y = T.yBot + tH / 2;

    const torsoTop = sph('torsoTop', T.topR * 2, 20);
    torsoTop.scaling.y = 0.55;
    torsoTop.material = mats.shirt;
    torsoTop.parent = torsoPivot;
    torsoTop.position.y = T.yTop;

    // shallow hem: a deep rounded bottom reads as a dress and swallows the legs
    const torsoBot = sph('torsoBot', T.botR * 2, 20);
    torsoBot.scaling.y = T.hemSquash;
    torsoBot.material = mats.shirt;
    torsoBot.parent = torsoPivot;
    torsoBot.position.y = T.yBot;

    /* Torso is a tapered cylinder, so anything worn on the chest has to be
     * placed against the radius AT ITS OWN HEIGHT - otherwise it sinks inside. */
    const torsoR = (y) => {
      const k = Math.min(1, Math.max(0, (y - T.yBot) / tH));
      return T.botR + k * (T.topR - T.botR);
    };
    // sit a chest detail on the surface, sunk `embed` deep so no seam shows
    const onChest = (y, embed) => V3(0, y, torsoR(y) - (embed || 0.012));

    /* collar */
    [-1, 1].forEach((side) => {
      const y = T.yTop - 0.018;
      const c = box('collar' + (side < 0 ? 'L' : 'R'), 0.105, 0.080, 0.026);
      c.material = mats.shirt;
      c.parent = torsoPivot;
      c.position.set(side * 0.068, y, torsoR(y) - 0.030);
      c.rotation.z = side * deg(34);
      c.rotation.x = deg(14);
    });

    /* necktie - knot, blade and mitred tip, each on the chest surface */
    const knotY = T.yTop - 0.048;
    const knot = box('tieKnot', 0.070, 0.074, 0.046);
    knot.material = mats.dark;
    knot.parent = torsoPivot;
    knot.position.copyFrom(onChest(knotY, 0.016));
    knot.rotation.x = deg(6);

    const bladeY = T.yTop - 0.180;
    const blade = box('tieBlade', 0.076, 0.215, 0.030);
    blade.material = mats.dark;
    blade.parent = torsoPivot;
    blade.position.copyFrom(onChest(bladeY, 0.010));
    blade.rotation.x = deg(-5);

    const tipY = T.yTop - 0.298;
    const tieTip = box('tieTip', 0.076, 0.076, 0.030);
    tieTip.material = mats.dark;
    tieTip.parent = torsoPivot;
    tieTip.rotation.z = deg(45);
    tieTip.rotation.x = deg(-5);
    tieTip.position.copyFrom(onChest(tipY, 0.008));

    /* ---------------------------------------------------------------- arms */
    const A = C.arm;
    const mkArm = (side) => {
      const tag = side < 0 ? 'L' : 'R';
      const pivot = new B.TransformNode('armPivot' + tag, scene);
      pivot.parent = root;
      pivot.position.set(side * A.xPivot, A.yPivot, 0);
      pivot.rotation.z = side * -deg(A.outDeg);
      pivot.rotation.x = deg(A.fwdDeg);

      // keep the shoulder tight: an oversized ball reads as a puffed sleeve and
      // makes the arm look bolted on rather than growing out of the torso
      const shoulder = sph('shoulder' + tag, A.r * A.shoulderMul, 14);
      shoulder.material = mats.shirt;
      shoulder.parent = pivot;

      const sleeve = cap('sleeve' + tag, A.r, A.len);
      sleeve.material = mats.shirt;
      sleeve.parent = pivot;
      sleeve.position.y = -A.len / 2;

      const hand = sph('hand' + tag, C.hand.r * 2, 14);
      hand.scaling.set(1, 0.92, 0.95);
      hand.material = mats.skin;
      hand.parent = pivot;
      hand.position.y = -A.len - 0.012;
      return pivot;
    };
    const armL = mkArm(-1), armR = mkArm(1);

    /* -------------------------------------------------------- legs + shoes */
    const L = C.leg, S = C.shoe;
    const hipPivot = new B.TransformNode('hipPivot', scene);
    hipPivot.parent = root;
    hipPivot.position.y = C.hip.y;                 // leg parts are hip-local

    const mkLeg = (side) => {
      const tag = side < 0 ? 'L' : 'R';
      const pivot = new B.TransformNode('legPivot' + tag, scene);
      pivot.parent = hipPivot;
      pivot.position.set(side * C.hip.x, 0, 0);

      const pant = cap('pant' + tag, L.r, L.len);
      pant.material = mats.dark;
      pant.parent = pivot;
      pant.position.y = -L.len / 2;

      /* High-top sneaker, leg-local: white rubber sole wrapping a black canvas
       * upper, with a white toe cap. Rounded volumes throughout - a flat slab
       * sole reads as an ice skate. */
      const ankleY = -L.len;

      // black canvas upper, rounded and slightly longer than it is wide
      const upper = sph('shoeUpper' + tag, 1, 16);
      upper.scaling.set(S.w, S.h * 1.10, S.d);
      upper.material = mats.dark;
      upper.parent = pivot;
      upper.position.set(0, ankleY + S.h * 0.34, S.toeOut);

      // rubber sole: a flattened sphere so it curves up at heel and toe
      const sole = sph('shoeSole' + tag, 1, 16);
      sole.scaling.set(S.w * 1.03, S.soleT * 1.5, S.d * 1.02);
      sole.material = mats.sole;
      sole.parent = pivot;
      sole.position.set(0, ankleY + S.soleT * 0.42, S.toeOut);

      // white toe cap over the front third
      const toe = sph('shoeToe' + tag, 1, 14);
      toe.scaling.set(S.w * 0.99, S.h * 0.70, S.d * 0.46);
      toe.material = mats.sole;
      toe.parent = pivot;
      toe.position.set(0, ankleY + S.h * 0.30, S.toeOut + S.d * 0.27);

      // padded ankle collar, sitting around the top of the high-top
      const collar = B.MeshBuilder.CreateTorus('shoeAnkle' + tag, {
        diameter: L.r * 2.30, thickness: 0.034, tessellation: 14
      }, scene);
      collar.material = mats.dark;
      collar.parent = pivot;
      collar.rotation.x = deg(86);
      collar.position.set(0, ankleY + S.h * 0.86, S.toeOut - S.d * 0.16);
      return pivot;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    /* ------------------------------------------------------------- tidy up */
    const meshes = root.getChildMeshes();
    meshes.forEach((m) => { m.isPickable = false; });

    // report the true silhouette so callers can frame the camera correctly
    let minY = Infinity, maxY = -Infinity;
    meshes.forEach((m) => {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, bb.minimumWorld.y);
      maxY = Math.max(maxY, bb.maximumWorld.y);
    });
    // drop the rig so the lowest point (sole) rests exactly on y = 0
    root.position.y -= minY;

    return {
      root, headPivot, torsoPivot, hipPivot,
      armL, armR, legL, legR,
      cfg: C, mats, meshes,
      height: maxY - minY,
      parts: { head, hair, eyeL, eyeR, nose, mouth, neck, torsoBody }
    };
  }

  global.createCharacter = createCharacter;
})(window);
