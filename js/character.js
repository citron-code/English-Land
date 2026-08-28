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
      // rounder than an almond, and the highlight is a flat decal ON the eye -
      // a protruding sphere reads as a bead glued to the face
      eye:  { w: 0.095, h: 0.118, d: 0.055, x: 0.090, y: 0.020, inset: 0.014,
              tiltDeg: 3, yawDeg: 9,
              // x/y are fractions of the eye's half-width/height, so the
              // highlight stays put if the eye is resized
              spark: { d: 0.022, fx: -0.30, fy: 0.42, flat: 0.32 } },
      brow: { w: 0.082, h: 0.016, d: 0.026, y: 0.093, tiltDeg: 8 },
      nose: { r: 0.031, h: 0.046, y: -0.038, thin: 0.55 },
      mouth:{ w: 0.090, lift: 0.021, y: -0.106, r: 0.0080 },
      ear:  { r: 0.050, xFactor: 0.955, y: -0.016 },
      earring: { d: 0.056, t: 0.012, drop: 0.070 }
    },

    /* Hair is a shell CONCENTRIC with the skull - only `shell` thicker than it
     * everywhere - so it can never lift off the head. Volume comes from raising
     * the crown, never from scaling XZ: a cap wider than the head shows a brim
     * under it and reads as a mushroom sitting on top.
     *
     * All roughness uses coherent angular noise, so neighbouring vertices move
     * together and the silhouette waves. Per-vertex randomness shatters it. */
    hair: {
      shell: 0.026, crown: 0.078, crownPow: 1.0, slice: 0.64,
      segments: 14, back: -0.010,
      // soft ceiling: everything above `from` is compressed toward it, so the
      // crown reads as a broad dome instead of coming to a point
      flat:  { from: 0.200, squash: 0.55 },
      // Two noise scales: lobe gives broad mass variation so the head isn't a
      // moulded dome, facet gives the low-poly faceting on top. Keep lobe
      // small - at 0.03 it stacks with the crown into a witch-hat peak.
      lobe:  0.014,
      facet: 0.019,
      rimWave: 0.042,        // points around the lower edge
      // a slight parting direction; too much and the hairline goes off-axis
      sweep: { x: 0.007, z: 0.004 },
      // hairline: y at the temples, dip lowers it centrally, wave roughens it
      cut:   { y: 0.128, dip: 0.038, wave: 0.024, sideReach: 0.38 },
      tufts: { count: 4, len: [0.035, 0.065], r: [0.050, 0.085] },
      /* Locks only where they read as hair. Across the temples they project
       * past the silhouette as black blades, so that arc is left to the shell. */
      fringeLocks: { count: 6, spreadDeg: 118, len: [0.026, 0.044], w: [0.030, 0.052] },
      napeLocks:   { count: 14, len: [0.050, 0.115], w: [0.038, 0.070],
                     elevDeg: -20, backOf: -0.20 },
      burns: { len: 0.052, r: 0.038 },
      seed:  20260828
    },

    // contact shadow blob: the shadow map alone leaves the figure hovering
    contact: { on: true, w: 0.68, d: 0.50, alpha: 0.85 },

    /* Neighbouring parts need a value break or they merge into one mass:
     * shirtSh separates cuffs/collar from the shirt, and trouser is lifted off
     * shoe so the ankle reads instead of the leg ending in a black blob. */
    colors: {
      skin:    '#d59a6b',
      skinSh:  '#c98a5c',
      hair:    '#191920',
      shirt:   '#f5f4f0',
      shirtSh: '#dedcd4',
      tie:     '#17171b',
      trouser: '#262631',
      shoe:    '#121216',
      sole:    '#fbfbf7',
      eye:     '#2b1d13',
      spark:   '#f6f2ec',
      nose:    '#e08a4e',
      mouth:   '#7a4d3a',
      silver:  '#c2c2c9'
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
    const m = {
      skin:    mk('skin',    colors.skin,    0.05, 56),
      skinSh:  mk('skinSh',  colors.skinSh,  0.04, 48),
      hair:    mk('hair',    colors.hair,    0.20, 22),
      shirt:   mk('shirt',   colors.shirt,   0.06, 44),
      shirtSh: mk('shirtSh', colors.shirtSh, 0.05, 40),
      tie:     mk('tie',     colors.tie,     0.08, 44),
      trouser: mk('trouser', colors.trouser, 0.07, 40),
      shoe:    mk('shoe',    colors.shoe,    0.10, 50),
      sole:    mk('sole',    colors.sole,    0.06, 44),
      eye:     mk('eye',     colors.eye,     0.50, 110),
      spark:   mk('spark',   colors.spark,   0.65, 128),
      nose:    mk('nose',    colors.nose,    0.05, 44),
      mouth:   mk('mouth',   colors.mouth,   0.05, 44),
      silver:  mk('silver',  colors.silver,  0.75, 128)
    };
    // Displacing the hair vertices flips the winding on a few crown triangles.
    // Culled, those read as holes straight through the head to the background.
    m.hair.backFaceCulling = false;
    return m;
  }

  /* -------------------------------------------------------------------- hair
   * Built entirely in HEAD-LOCAL space: the head centre is the origin here.
   */
  function buildHair(scene, C, mats, rng) {
    const R = C.head.r, H = C.hair;
    const pieces = [];

    /* Coherent angular noise: a few summed sines. Neighbouring vertices get
     * near-identical values, so the surface facets and the rim waves. Feeding
     * rng() per vertex instead is what shattered the old rim into shards. */
    const p1 = rng() * 6.283, p2 = rng() * 6.283, p3 = rng() * 6.283;
    const q1 = rng() * 6.283, q2 = rng() * 6.283;
    const wave = (a) =>
      Math.sin(a * 3 + p1) * 0.55 + Math.sin(a * 5 + p2) * 0.30 + Math.sin(a * 9 + p3) * 0.15;
    // lower frequency: broad lumps of mass rather than surface facets
    const lobe = (a) => Math.sin(a * 2 + q1) * 0.62 + Math.sin(a * 3 + q2) * 0.38;
    const n01  = (v) => (v + 1) / 2;

    // compress the crown toward a ceiling so the top stays broad, not pointed
    const flatten = (y) =>
      y > H.flat.from ? H.flat.from + (y - H.flat.from) * H.flat.squash : y;

    const rr = R + H.shell;                 // concentric with the skull
    const cap = B.MeshBuilder.CreateSphere('hairCap', {
      diameter: 2 * rr, segments: H.segments, slice: H.slice
    }, scene);

    const pos = cap.getVerticesData(B.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) {
      const v = V3(pos[i], pos[i + 1], pos[i + 2]);
      const len = v.length();
      if (len < 1e-5) continue;
      const n = v.scale(1 / len);
      const az = Math.atan2(n.x, n.z);

      /* Fade the azimuthal noise out toward the pole. A UV sphere stacks many
       * coincident vertices there and `az` is undefined at that point, so each
       * duplicate takes a different displacement, pulls apart from its twins
       * and tears visible holes in the crown. Anything keyed on `az` must go
       * to zero as the vertices converge. */
      const horiz = Math.sqrt(Math.max(0, 1 - n.y * n.y));   // 0 at the pole
      const amp   = Math.min(1, horiz / 0.30);

      // faceting stays radial, so the shell keeps hugging the skull
      const r = len
        + (lobe(az * 1.0 + n.y * 1.6) * H.lobe
        +  wave(az * 1.7 + n.y * 3.0) * H.facet) * amp;
      let   x = n.x * r;
      let   y = n.y * r;
      let   z = n.z * r + H.back;

      // Crown volume: raise the top only. Scaling XZ instead would push the
      // shell off the sides of the head and expose a brim underneath.
      y += H.crown * Math.pow(Math.max(0, n.y), H.crownPow);

      // Sweep the mass off to one side, strongest at the crown, so the hair
      // has a parting direction instead of being perfectly radial.
      const top = Math.pow(Math.max(0, n.y), 1.2);
      x += H.sweep.x * top;
      z += H.sweep.z * top;

      y = flatten(y);

      // hairline: lift front vertices onto an arc that dips centrally, fading
      // out around the temples so the back and sides stay covered
      const t  = Math.min(1, Math.abs(x) / rr);
      const hy = H.cut.y - (1 - t * t) * H.cut.dip + wave(az * 2.0) * H.cut.wave;
      const lift = Math.min(1, Math.max(0, n.z + H.cut.sideReach));
      if (y < hy) y += (hy - y) * lift;

      // points around the lower edge, coherent so they read as locks of hair
      const low = 1 - Math.min(1, Math.max(0, (n.y + 0.30) / 0.45));
      y += wave(az * 4.0 + 1.3) * H.rimWave * low;

      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
    }
    cap.setVerticesData(B.VertexBuffer.PositionKind, pos);
    pieces.push(cap);

    // where the shell surface sits along a given direction
    const capSurface = (dir) => {
      const d = dir.normalizeToNew();
      return V3(d.x * rr,
                flatten(d.y * rr + H.crown * Math.pow(Math.max(0, d.y), H.crownPow)),
                d.z * rr + H.back);
    };

    // height of the carved hairline at a given x, for seating the fringe
    const hairlineAt = (x) => {
      const zz = Math.sqrt(Math.max(0.0001, rr * rr - x * x));
      const t  = Math.min(1, Math.abs(x) / rr);
      return H.cut.y - (1 - t * t) * H.cut.dip
             + wave(Math.atan2(x, zz) * 2.0) * H.cut.wave;
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
      // lay the tips back rather than up: pointing them upward re-introduces
      // the peak the crown ceiling is there to remove
      const point = dir.add(V3(0, 0.04, -0.42)).normalize();
      addChunk(dir, point, len, baseR, 4, 0.45, 0.40);
    }

    /* The fringe is carved into the shell edge itself (see the hairline arc
     * above), not bolted on as separate cones - those read as fangs.
     *
     * Locks break up the moulded-dome silhouette, but only where they read as
     * hair. Across the temples they project past the outline as black blades,
     * so that arc is left to the shell alone. */

    /* short strands off the hairline, so the fringe edge isn't a clean arc */
    const FL = H.fringeLocks;
    const fSpread = deg(FL.spreadDeg);
    for (let i = 0; i < FL.count; i++) {
      const f = FL.count === 1 ? 0.5 : i / (FL.count - 1);
      const theta = -fSpread / 2 + f * fSpread;
      const x  = Math.sin(theta) * rr * 0.88;
      const z  = Math.sqrt(Math.max(0.0001, rr * rr - x * x)) * 0.90 + H.back;
      const len = FL.len[0] + n01(wave(theta * 5.0)) * (FL.len[1] - FL.len[0]);
      const w   = FL.w[0]   + n01(lobe(theta * 4.0)) * (FL.w[1]   - FL.w[0]);
      // down and slightly forward; short enough to clear the eyes
      const point = V3((x / rr) * 0.30, -1, 0.26).normalize();
      addChunkAt(V3(x, hairlineAt(x) + 0.014, z), point, len, w, 3, 0.70, 0.15);
    }

    /* longer, shaggier locks down the back of the head */
    const NL = H.napeLocks;
    for (let i = 0; i < NL.count; i++) {
      const az = (i / NL.count) * Math.PI * 2;
      const dx = Math.sin(az), dz = Math.cos(az);
      if (dz > NL.backOf) continue;                      // back arc only

      const elev = deg(NL.elevDeg + wave(az * 2.2) * 8);
      const dir  = V3(dx * Math.cos(elev), Math.sin(elev), dz * Math.cos(elev));
      const len  = NL.len[0] + n01(wave(az * 3.0 + 0.7)) * (NL.len[1] - NL.len[0]);
      const w    = NL.w[0]   + n01(lobe(az * 2.0))       * (NL.w[1]   - NL.w[0]);

      // hang close to the skull - splaying outward turns them into spikes
      const point = V3(dx * 0.12, -1, dz * 0.12).normalize();
      addChunkAt(capSurface(dir), point, len, w, 3, 0.55, 0.12);
    }

    /* No separate sideburn chunks: seated out at the temples they always
     * protrude past the hair silhouette as black wings, whatever the size.
     * The shell's own hairline already carries the hair down past the temple. */

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

    /* Everything above the hips hangs off bodyPivot, which sits AT hip height.
     * Walk lean and torso twist rotate this, so the upper body swings about
     * the waist and the feet stay planted. Rotating root instead tips the
     * whole figure, soles included. */
    const bodyPivot = new B.TransformNode('bodyPivot', scene);
    bodyPivot.parent = root;
    bodyPivot.position.y = C.hip.y;
    const upperY = (y) => y - C.hip.y;      // world height -> bodyPivot-local

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
    headPivot.parent = bodyPivot;
    headPivot.position.y = upperY(C.head.y);      // everything below is head-local

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

      // Flattened and offset to the same side on BOTH eyes, so the highlight
      // reads as one light source rather than a cross-eyed pair of beads.
      // Projected ONTO the eyeball's curved surface - at a fixed z it floats
      // clear of the eye and reads as a dot stuck on the face.
      const S = F.eye.spark;
      const sx = S.fx * (F.eye.w / 2);
      const sy = S.fy * (F.eye.h / 2);
      const k  = Math.max(0, 1 - S.fx * S.fx - S.fy * S.fy);
      const sz = (F.eye.d / 2) * Math.sqrt(k);      // ellipsoid surface depth

      const spark = sph('eyeSpark' + (side < 0 ? 'L' : 'R'), S.d, 10);
      spark.scaling.z = S.flat;
      spark.material = mats.spark;
      spark.position.set(sx, sy, sz);               // straddles the surface
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
    neck.parent = bodyPivot;
    neck.position.y = upperY(C.neck.y);

    /* --------------------------------------------------------- torso/shirt */
    const T = C.torso;
    const tH = T.yTop - T.yBot;
    const torsoPivot = new B.TransformNode('torsoPivot', scene);
    torsoPivot.parent = bodyPivot;
    torsoPivot.position.y = -C.hip.y;      // its children use world-height Y

    // body and caps share a radial count, or the joins scallop visibly
    const TSEG = 24;
    const torsoBody = cyl('torsoBody', T.topR * 2, T.botR * 2, tH, TSEG);
    torsoBody.material = mats.shirt;
    torsoBody.parent = torsoPivot;
    torsoBody.position.y = T.yBot + tH / 2;

    // Caps are a touch larger than the body. At equal radius their surfaces are
    // coincident with the cylinder rim and z-fight into a dashed scallop.
    const CAP = 1.03;
    const torsoTop = sph('torsoTop', T.topR * 2 * CAP, TSEG);
    torsoTop.scaling.y = 0.55;
    torsoTop.material = mats.shirt;
    torsoTop.parent = torsoPivot;
    torsoTop.position.y = T.yTop;

    // shallow hem: a deep rounded bottom reads as a dress and swallows the legs
    const torsoBot = sph('torsoBot', T.botR * 2 * CAP, TSEG);
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

    /* Collar: a band flaring from the neck out to the shoulders, plus two
     * points forming a V around the knot. Two loose tabs on the chest read as
     * notches cut in the shirt rather than as a collar. */
    const bandY = T.yTop - 0.004;
    const band = cyl('collarBand', C.neck.r * 2.35, T.topR * 1.24, 0.044, 24);
    band.material = mats.shirtSh;
    band.parent = torsoPivot;
    band.position.y = bandY;

    [-1, 1].forEach((side) => {
      const y = T.yTop - 0.052;
      const pt = box('collarPt' + (side < 0 ? 'L' : 'R'), 0.052, 0.115, 0.026);
      pt.material = mats.shirt;
      pt.parent = torsoPivot;
      pt.position.set(side * 0.055, y, torsoR(y) - 0.012);
      pt.rotation.z = side * deg(20);
      pt.rotation.x = deg(10);
    });

    /* Necktie. Three separate boxes at fixed depths visibly step apart as the
     * torso tapers, so the blade is ONE ribbon whose vertices are wrapped onto
     * the chest at whatever radius the torso has at each height. */
    const knotY = T.yTop - 0.048;
    const knot = box('tieKnot', 0.072, 0.076, 0.046);
    knot.material = mats.tie;
    knot.parent = torsoPivot;
    knot.position.copyFrom(onChest(knotY, 0.014));
    knot.rotation.x = deg(6);

    const tieTop = knotY - 0.020;                 // starts inside the knot
    const tieBot = T.yTop - 0.345;
    const STEPS = 26;
    const edgeL = [], edgeR = [];
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      const y = tieTop + (tieBot - tieTop) * f;
      // narrow under the knot, widening down the blade, then mitred to a point
      const w = f > 0.88
        ? 0.098 * (1 - (f - 0.88) / 0.12) + 0.004
        : 0.070 + 0.028 * Math.pow(f / 0.88, 0.8);
      const rad = torsoR(y) + 0.006;              // sit just proud of the shirt
      const ang = Math.asin(Math.min(0.98, (w / 2) / rad));
      edgeL.push(V3(-Math.sin(ang) * rad, y, Math.cos(ang) * rad));
      edgeR.push(V3( Math.sin(ang) * rad, y, Math.cos(ang) * rad));
    }
    const blade = B.MeshBuilder.CreateRibbon('tieBlade', {
      pathArray: [edgeL, edgeR], sideOrientation: B.Mesh.DOUBLESIDE
    }, scene);
    blade.material = mats.tie;
    blade.parent = torsoPivot;

    /* ---------------------------------------------------------------- arms */
    const A = C.arm;
    const mkArm = (side) => {
      const tag = side < 0 ? 'L' : 'R';
      const pivot = new B.TransformNode('armPivot' + tag, scene);
      pivot.parent = bodyPivot;
      pivot.position.set(side * A.xPivot, upperY(A.yPivot), 0);
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

      // Cuff: white-on-white, the sleeve otherwise merges with the torso into
      // one shape. A slightly shaded band gives the arm an edge to end on.
      const cuff = cyl('cuff' + tag, A.r * 2.20, A.r * 2.24, 0.042, 16);
      cuff.material = mats.shirtSh;
      cuff.parent = pivot;
      cuff.position.y = -A.len + 0.014;

      const hand = sph('hand' + tag, C.hand.r * 2, 14);
      hand.scaling.set(1, 0.92, 0.95);
      hand.material = mats.skin;
      hand.parent = pivot;
      hand.position.y = -A.len - 0.028;
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
      pant.material = mats.trouser;
      pant.parent = pivot;
      pant.position.y = -L.len / 2;

      // turned-up hem: gives the trouser a visible end instead of dissolving
      // into the shoe, which is nearly the same value
      const hem = cyl('hem' + tag, L.r * 2.16, L.r * 2.10, 0.038, 16);
      hem.material = mats.trouser;
      hem.parent = pivot;
      hem.position.y = -L.len + 0.052;

      /* High-top sneaker, leg-local: white rubber sole wrapping a black canvas
       * upper, with a white toe cap. Rounded volumes throughout - a flat slab
       * sole reads as an ice skate. */
      const ankleY = -L.len;

      // black canvas upper, rounded and slightly longer than it is wide
      const upper = sph('shoeUpper' + tag, 1, 16);
      upper.scaling.set(S.w, S.h * 1.10, S.d);
      upper.material = mats.shoe;
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
      collar.material = mats.shoe;
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

    /* Contact shadow. The shadow map gives a soft blob but no darkening where
     * the soles actually meet the ground, which reads as hovering. This is a
     * radial-gradient decal pinned under the feet.
     * Built AFTER `meshes` is captured so it is neither a shadow caster nor
     * part of the silhouette measurement. */
    let contactBlob = null;
    if (C.contact.on) {
      const TEX = 256;
      const dt = new B.DynamicTexture('contactTex', { width: TEX, height: TEX }, scene, false);
      // Painted as a LUMINANCE ramp, not black-with-alpha: opacityTexture reads
      // brightness, so a black gradient is uniformly transparent and invisible.
      const g2 = dt.getContext();
      const grad = g2.createRadialGradient(TEX / 2, TEX / 2, 0, TEX / 2, TEX / 2, TEX / 2);
      grad.addColorStop(0.00, '#ffffff');
      grad.addColorStop(0.28, '#e0e0e0');
      grad.addColorStop(0.62, '#6a6a6a');
      grad.addColorStop(1.00, '#000000');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, TEX, TEX);
      dt.update();
      dt.getAlphaFromRGB = true;

      const cmat = new B.StandardMaterial('contactMat', scene);
      cmat.disableLighting = true;                 // it IS the shading
      cmat.diffuseColor = B.Color3.Black();
      cmat.emissiveColor = B.Color3.Black();
      cmat.opacityTexture = dt;
      cmat.alpha = C.contact.alpha;

      const blob = B.MeshBuilder.CreateGround('contactShadow', {
        width: C.contact.w, height: C.contact.d
      }, scene);
      blob.material = cmat;
      // Deliberately NOT parented to root: the rig bobs, squashes on landing
      // and leaves the ground on a jump, none of which the ground decal should
      // inherit. The animator drives its position instead.
      blob.position.set(root.position.x, 0.004, root.position.z);
      blob.isPickable = false;
      blob.receiveShadows = false;
      contactBlob = blob;
    }

    return {
      root, bodyPivot, headPivot, torsoPivot, hipPivot,
      armL, armR, legL, legR,
      cfg: C, mats, meshes,
      height: maxY - minY,
      groundOffset: root.position.y,      // root Y that rests the soles on 0
      contact: contactBlob,
      parts: { head, hair, eyeL, eyeR, nose, mouth, neck, torsoBody }
    };
  }

  global.createCharacter = createCharacter;
})(window);
