/*
 * English Land - procedural low-poly villager
 * ---------------------------------------------------------------------------
 * Proportions follow the reference turnaround: head plus hair is about 36% of
 * total height, the shirt and limbs are slim, and the hair is a faceted helmet
 * with a sawtooth fringe rather than a shaggy mop.
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

  /* ---------------------------------------------------------------- defaults */
  /* All Y values are metres above the ground plane (soles rest exactly on 0). */
  /* Proportions measured off the reference turnaround, as fractions of total
   * height: shoes 10%, trousers 22%, shirt 27.5%, neck 3.5%, head+hair 36.5%.
   * Widths matter as much as heights - the figure reads wrong the moment it
   * gets barrel-chested. Against the same total height the reference gives
   * head+hair 33% wide, shirt 21%, sleeve 6%, trouser 7%, shoe 10%.
   *
   * The skull is a PLAIN SPHERE on purpose. The reference head is taller than
   * it is wide, but that extra height is hair piled on the crown, not a
   * stretched skull - and a non-uniform head would break `onFace`, the ear
   * seats and the concentric hair shell all at once. */
  const DEFAULTS = {
    // tiltDeg lifts the chin so the character meets the camera rather than
    // looking at its own feet; it lives on headBase, not on the animated pivot
    head:  { r: 0.212, y: 1.258, tiltDeg: 9, sx: 1.00, sy: 1.00, sz: 1.00 },
    neck:  { r: 0.066, y: 1.000, h: 0.090 },
    torso: { yTop: 1.010, yBot: 0.620, topR: 0.156, botR: 0.136,
             // the shirt flares to this at the shoulder, wider than the arm pivot
             shoulderR: 0.206, depth: 0.68 },
    // len is tuned so the hands land level with the shirt hem
    // yPivot sits BELOW the shirt shoulder, so the sleeve hangs out of it
    arm:   { r: 0.058, len: 0.300, xPivot: 0.186, yPivot: 0.906,
             outDeg: 5, fwdDeg: 3, shoulderMul: 1.95 },
    /* thumbPoseX is the arm pitch the thumbs-up emote uses. The thumb is
     * counter-rotated by exactly this, so at that pose it points straight up
     * in world space. Change one and the other follows. */
    hand:  { r: 0.076, thumbR: 0.026, thumbLen: 0.082, thumbPoseX: -1.85 },
    hip:   { y: 0.620, x: 0.082 },
    leg:   { r: 0.066, len: 0.432 },
    shoe:  { w: 0.150, h: 0.140, d: 0.232, toeOut: 0.032, soleT: 0.038 },

    /* Face heights are given in fractions of the head radius, because that is
     * how they were read off the reference, and because the whole face then
     * survives a change of head size. On the reference the eyes sit BELOW the
     * middle of the skull - features clustered above centre are what gives a
     * character a bulging forehead and a slab of empty chin. */
    face: {
      /* A perfectly round eye, painted as one texture (see mkEye).
       * `r` is the disc's radius, `out` how far it stands off the skull, and
       * `yawDeg` how far it splays outward to sit on the cheek. Everything
       * inside `tex` is a fraction of that radius, so the whole face survives a
       * change of eye size. Both highlights are offset the same way on both
       * eyes: mirroring them reads as a squint, not as a light source. */
      eye:  { r: 0.043, x: 0.083, yR: -0.19, out: 0.003,
              tiltDeg: 0, tess: 40,
              tex: { size: 256, white: 0.92, iris: 0.76, pupil: 0.42,
                     spark:  { r: 0.170, x: -0.28, y:  0.32 },
                     spark2: { r: 0.085, x:  0.32, y: -0.28 } } },
      /* Brows are OFF by default. Angled down toward the nose they read as a
       * scowl, and on a face this small there is no room between the fringe
       * tips and the top of the eye to place them anywhere friendlier.
       * tiltDeg is kept for anyone who turns them back on. */
      brow: { on: false, w: 0.052, h: 0.010, d: 0.024, yR: -0.02, tiltDeg: 0 },
      // a wedge pointing forward and down, so it reads as a triangle from the
      // front and as a real point in profile
      nose: { r: 0.026, h: 0.042, yR: -0.39, thin: 0.86, pitchDeg: 32 },
      mouth:{ w: 0.052, lift: 0.014, yR: -0.59, r: 0.0052 },
      ear:  { r: 0.036, xFactor: 1.00, yR: -0.16 },
      earring: { d: 0.034, t: 0.008, drop: 0.038 }
    },

    /* Hair is a shell CONCENTRIC with the skull - only `shell` thicker than it
     * everywhere - so it can never lift off the head. Volume comes from raising
     * the crown, never from scaling XZ: a cap wider than the head shows a brim
     * under it and reads as a mushroom sitting on top. That is also what makes
     * the head read as taller than it is wide, like the reference, without
     * stretching the skull itself.
     *
     * The fringe is a SAWTOOTH LOCKED TO THE SPHERE'S OWN VERTEX COLUMNS: every
     * second column is pulled down by `tooth`, so each point is exactly one
     * triangle and they all come out the same size. A tooth at some arbitrary
     * period lands mid-facet and frays into noise instead. */
    hair: {
      shell: 0.019, crown: 0.078, crownPow: 0.85, slice: 0.80,
      segments: 14, back: -0.013, puff: 0.009,
      // soft ceiling: everything above `from` is compressed toward it, so the
      // crown reads as a broad dome instead of coming to a point
      flat:  { from: 0.165, squash: 0.66 },
      // Coherent angular noise, so neighbouring vertices move together and the
      // silhouette waves. Per-vertex randomness shatters it. Kept low: the
      // reference hair is a clean faceted helmet, not a shaggy mop.
      lobe:  0.007,
      facet: 0.009,
      // a slight parting direction; too much and the hairline goes off-axis
      sweep: { x: 0.006, z: 0.003 },
      /* hairline: `y` at the temples, `dip` lowers it centrally, `tooth` is how
       * far alternate columns hang below it. sideReach controls how far round
       * the head the carve reaches - push it up and the hair lifts off the
       * temples and uncovers the ears. */
      cut:   { y: 0.058, dip: 0.014, tooth: 0.038, wave: 0.012, sideReach: 0.55 },
      // sideburn: how far the hair runs down in front of each ear
      burns: { reach: 0.70, drop: 0.058, w: 0.26 },
      seed:  20260828
    },
    contact: { on: true, w: 0.68, d: 0.50, alpha: 0.85 },

    /* Neighbouring parts need a value break or they merge into one mass:
     * shirtSh separates cuffs/collar from the shirt, and trouser is lifted off
     * shoe so the ankle reads instead of the leg ending in a black blob. */
    colors: {
      skin:    '#f3c8a4',
      skinSh:  '#e0ac85',
      hair:    '#191a21',
      shirt:   '#f7f6f2',
      shirtSh: '#e2e0d8',
      tie:     '#15151a',
      trouser: '#1b1b22',
      shoe:    '#141418',
      sole:    '#fafaf6',
      sclera:  '#fdfaf6',
      lash:    '#3a2418',        // thin dark rim that outlines the eye
      eye:     '#4b2e1c',        // iris
      pupil:   '#221309',
      spark:   '#ffffff',
      nose:    '#e8895c',
      mouth:   '#7a4335',
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

    /* Coherent angular noise: a few summed sines. Neighbouring vertices get
     * near-identical values, so the surface facets instead of shattering the
     * way per-vertex rng() does. */
    const p1 = rng() * 6.283, p2 = rng() * 6.283, p3 = rng() * 6.283;
    const q1 = rng() * 6.283, q2 = rng() * 6.283;
    const wave = (a) =>
      Math.sin(a * 3 + p1) * 0.55 + Math.sin(a * 5 + p2) * 0.30 + Math.sin(a * 9 + p3) * 0.15;
    // lower frequency: broad lumps of mass rather than surface facets
    const lobe = (a) => Math.sin(a * 2 + q1) * 0.62 + Math.sin(a * 3 + q2) * 0.38;

    // compress the crown toward a ceiling so the top stays broad, not pointed
    const flatten = (y) =>
      y > H.flat.from ? H.flat.from + (y - H.flat.from) * H.flat.squash : y;

    const rr = R + H.shell;                 // concentric with the skull
    const cap = B.MeshBuilder.CreateSphere('hairCap', {
      diameter: 2 * rr, segments: H.segments, slice: H.slice
    }, scene);

    /* Babylon lays a sphere out with 2 * (2 + segments) columns of vertices.
     * Rounding an azimuth to that grid is what lets the fringe sawtooth land
     * exactly on vertex columns and come out as even triangles. */
    const AZ = 2 * (2 + H.segments);
    const azStep = (Math.PI * 2) / AZ;

    /* Hairline height for one azimuth. `t` is 0 dead ahead and 1 at the
     * temples: the fringe hangs lowest over the middle of the forehead and
     * rises toward the sides, and every second vertex column drops by `tooth`
     * to make the points. */
    const hairlineAt = (az, x) => {
      const t = Math.min(1, Math.abs(x) / rr);
      const col = Math.round(az / azStep);
      const tooth = (col & 1) ? H.cut.tooth : 0;
      return H.cut.y - (1 - t * t) * H.cut.dip - tooth + wave(az * 2.0) * H.cut.wave;
    };

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
      let r = len
        + (lobe(az * 1.0 + n.y * 1.6) * H.lobe
        +  wave(az * 1.7 + n.y * 3.0) * H.facet) * amp;

      // extra mass at the back of the skull, none at the front
      r += H.puff * Math.max(0, -n.z) * amp;

      let x = n.x * r;
      let y = n.y * r;
      let z = n.z * r + H.back;

      // Crown volume: raise the top only. Scaling XZ instead would push the
      // shell off the sides of the head and expose a brim underneath. This is
      // also where the head gets its taller-than-wide reading.
      y += H.crown * Math.pow(Math.max(0, n.y), H.crownPow);

      // Sweep the mass off to one side, strongest at the crown, so the hair
      // has a parting direction instead of being perfectly radial.
      const top = Math.pow(Math.max(0, n.y), 1.2);
      x += H.sweep.x * top;
      z += H.sweep.z * top;

      y = flatten(y);

      /* Carve the fringe. `lift` keeps the carve on the front of the head: at
       * the sides it falls to zero so the hair stays down over the temples and
       * ears, which is where the coverage in the reference comes from. */
      const lift = Math.min(1, Math.max(0, n.z + H.cut.sideReach));
      if (lift > 0) {
        const hy = hairlineAt(az, x);
        if (y < hy) y += (hy - y) * lift;
      }

      /* Sideburn: in the band just in front of each ear, hold the hair down
       * past the hairline so it ends in a point rather than a clean arc. */
      const sideness = Math.abs(n.x) - H.burns.reach;
      if (sideness > 0 && n.z > -0.1 && n.y < 0.25) {
        const k = Math.min(1, sideness / Math.max(0.05, H.burns.w));
        y -= H.burns.drop * k * Math.max(0, 1 - Math.abs(n.y) / 0.55);
      }

      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
    }
    cap.setVerticesData(B.VertexBuffer.PositionKind, pos);
    // the displacement invalidates the builder's bounds; without this the mesh
    // frustum-culls against a sphere it no longer fills
    cap.refreshBoundingInfo();

    cap.name = 'hair';
    cap.material = mats.hair;
    cap.convertToFlatShadedMesh();
    return cap;
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
    /* headBase carries the constant lift of the chin; headPivot is left free
     * for the animator, which writes headPivot.rotation outright every frame
     * and zeroes it in rest(). A base pose set there would simply be wiped.
     * Negative rotation.x swings the face UP: about X, +Z maps to
     * (0, -sin, cos). */
    const headBase = new B.TransformNode('headBase', scene);
    headBase.parent = bodyPivot;
    headBase.position.y = upperY(C.head.y);
    headBase.rotation.x = -deg(C.head.tiltDeg);

    const headPivot = new B.TransformNode('headPivot', scene);
    headPivot.parent = headBase;                  // everything below is head-local

    const head = sph('head', C.head.r * 2, 24);
    head.scaling.set(C.head.sx, C.head.sy, C.head.sz);
    head.material = mats.skin;
    head.parent = headPivot;

    const R = C.head.r;
    const F = C.face;
    // face heights are authored as fractions of the head radius
    const fy = (frac) => frac * R;
    // place a feature on the head surface; +push moves it outward
    const onFace = (x, y, push) => {
      const zz = Math.sqrt(Math.max(0.0001, R * R - x * x - y * y));
      return V3(x, y, zz * C.head.sz + (push || 0));
    };

    const eyeY = fy(F.eye.yR);

    /* Eyes are ONE TEXTURED DISC each, not a stack of lenses.
     *
     * Stacked lenses cannot stay concentric here. The eye has to yaw outward by
     * over 20 degrees to lie on the curve of a head this small, and once it
     * does, every ring pushed forward along the eye's own axis also slides
     * sideways on screen. The rings drift apart and the character reads as
     * cross-eyed. Painting them into a texture makes them concentric by
     * construction, from any angle, and costs one mesh per eye instead of six.
     *
     * The disc is flat while the head is round, so it is pushed out along the
     * surface normal by `out`, far enough that its rim never sinks into the
     * skull. `scaling.x` undoes the foreshortening the yaw would otherwise
     * cause, so head-on the eye reads as a true circle. The blink scales this
     * node's Y, so the whole eye squashes together. */
    const eyeMat = (() => {
      const T = F.eye.tex, S = T.size, col = C.colors;
      const dt = new B.DynamicTexture('eyeTex', { width: S, height: S }, scene, true);
      const g2 = dt.getContext();
      const R = S / 2;
      // The face we actually see is the disc.s BACK - a plain disc is wound to
      // face -Z - and its UVs are mirrored in u. So x is negated here and y is
      // not: positive x paints toward the outer corner, positive y upward.
      const dot = (fx, fy2, fr, fill) => {
        g2.beginPath();
        g2.arc(R - fx * R, R + fy2 * R, fr * R, 0, Math.PI * 2);
        g2.fillStyle = fill;
        g2.fill();
      };
      g2.fillStyle = col.lash;
      g2.fillRect(0, 0, S, S);                  // the rim, and everything past it
      dot(0, 0, T.white, col.sclera);
      dot(0, 0, T.iris,  col.eye);
      dot(0, 0, T.pupil, col.pupil);
      dot(T.spark.x,  T.spark.y,  T.spark.r,  col.spark);
      dot(T.spark2.x, T.spark2.y, T.spark2.r, col.spark);
      dt.update();

      const m = new B.StandardMaterial('eyeMat', scene);
      m.diffuseTexture = dt;
      m.specularColor = new B.Color3(0.10, 0.10, 0.10);
      m.specularPower = 90;
      return m;
    })();

    const mkEye = (side) => {
      const E = F.eye, tag = side < 0 ? 'L' : 'R';
      const ex = side * E.x;

      /* Lie the disc FLAT on the face, along the head's surface normal.
       *
       * Standing it upright instead is what made the character look like it was
       * staring at its own feet: the eye sits below the middle of the skull, so
       * an upright disc has its TOP edge behind the surface there and the skin
       * shaves the top off the circle. A circle with its lid cut off reads as a
       * half-closed eye every time. Following the normal keeps the circle whole.
       *
       * Both angles foreshorten the disc head-on, so the mesh is scaled back up
       * by the same amount and still reads as a true circle. That scaling lives
       * on the DISC, not on this node - the blink owns the node's Y. */
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      const pitch = -Math.asin(clamp(eyeY / R));
      const yaw   =  Math.asin(clamp(ex / Math.sqrt(Math.max(1e-6, R * R - eyeY * eyeY))));

      const surface = onFace(ex, eyeY, 0);
      const g = new B.TransformNode('eye' + tag, scene);
      g.parent = headPivot;
      g.position.copyFrom(surface.add(surface.normalizeToNew().scale(E.out)));
      g.rotation.set(pitch, yaw, side * -deg(E.tiltDeg));

      // DOUBLESIDE: a plain disc is wound to face -Z, so with back-face culling
      // on it is simply invisible from the front.
      const disc = B.MeshBuilder.CreateDisc("eyeDisc" + tag, {
        radius: E.r, tessellation: E.tess, sideOrientation: B.Mesh.DOUBLESIDE
      }, scene);
      disc.material = eyeMat;
      disc.parent = g;
      disc.scaling.set(1 / Math.cos(yaw), 1 / Math.cos(pitch), 1);
      return g;
    };
    const eyeL = mkEye(-1), eyeR = mkEye(1);

    /* brows - thin, sit in the gap between the eye and the fringe */
    if (F.brow.on) [-1, 1].forEach((side) => {
      const br = box("brow" + (side < 0 ? "L" : "R"), F.brow.w, F.brow.h, F.brow.d);
      br.material = mats.hair;
      br.parent = headPivot;
      // Only -0.006: the brow box is barely 0.02 deep, so sinking it further
      // than its own half-depth buries it inside the skull entirely.
      br.position.copyFrom(onFace(side * F.eye.x, fy(F.brow.yR), -0.006));
      br.rotation.z = side * deg(F.brow.tiltDeg);
      br.rotation.x = deg(-10);
    });

    /* Nose: a three-sided wedge pointing forward and down. The pitch lives on a
     * holder node and the spin on the mesh, because Babylon composes Euler
     * angles as Y*X*Z - putting both on one node would swing the whole nose
     * sideways instead of spinning it about its own axis. */
    const noseHolder = new B.TransformNode('noseHolder', scene);
    noseHolder.parent = headPivot;
    noseHolder.position.copyFrom(onFace(0, fy(F.nose.yR), -0.010));
    noseHolder.rotation.x = deg(90 + F.nose.pitchDeg);   // +Y tips toward +Z

    const nose = cyl('nose', 0, F.nose.r * 2, F.nose.h, 3);
    nose.material = mats.nose;
    nose.scaling.z = F.nose.thin;      // local z is vertical once pitched: a wide, flat wedge
    nose.parent = noseHolder;
    nose.position.y = F.nose.h * 0.34; // base sunk into the face, tip clear of it

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
    mouth.position.copyFrom(onFace(0, fy(F.mouth.yR), -0.006));

    /* Ears + hoop earrings. Nudged forward of the head centre so the hair
     * shell, which now covers the sides properly, does not swallow them. */
    const earY = fy(F.ear.yR);
    [-1, 1].forEach((side) => {
      const tag = side < 0 ? 'L' : 'R';
      const ear = sph('ear' + tag, F.ear.r * 2, 12);
      ear.scaling.set(0.55, 1, 0.85);
      ear.material = mats.skinSh;
      ear.parent = headPivot;
      ear.position.set(side * R * F.ear.xFactor, earY, R * 0.14);

      const ring = B.MeshBuilder.CreateTorus('earring' + tag, {
        diameter: F.earring.d, thickness: F.earring.t, tessellation: 16
      }, scene);
      ring.material = mats.silver;
      ring.rotation.x = Math.PI / 2;
      ring.parent = headPivot;
      ring.position.set(side * R * (F.ear.xFactor - 0.04),
                        earY - F.earring.drop, R * 0.15);
    });

    /* hair - built in head-local space, so parenting is a plain assignment */
    const hair = buildHair(scene, C, mats, rng);
    hair.parent = headPivot;

    /* ---------------------------------------------------------------- neck */
    // Plain skin, not the shade: the darker tone read as a tan band between the
    // chin and the collar rather than as a neck in shadow.
    const neck = cyl("neck", C.neck.r * 2, C.neck.r * 2.15, C.neck.h, 16);
    neck.material = mats.skin;
    neck.parent = bodyPivot;
    neck.position.y = upperY(C.neck.y);

    /* --------------------------------------------------------- torso/shirt */
    const T = C.torso;
    const tH = T.yTop - T.yBot;
    const torsoPivot = new B.TransformNode('torsoPivot', scene);
    torsoPivot.parent = bodyPivot;
    torsoPivot.position.y = -C.hip.y;      // its children use world-height Y

    // A single rounded profile keeps the shirt and lower hem as one continuous
    // surface; separate overlapping spheres leave a visible seam.
    const TSEG = 24;
    const TD = T.depth;                  // front-to-back squash of the whole shirt
    /* The shirt carries its own SHOULDER: the profile flares past `shoulderR`
     * near the top and only then rolls in to the neck.
     *
     * This is the whole reason the arms used to read as bolted-on knobs. With a
     * straight-sided shirt the sleeve's hemispherical top cap is the only
     * shoulder there is, and it stands proud of the shirt's square top corner
     * as a complete ball silhouetted against the background. Once the shirt
     * reaches out past the arm pivot, that cap is buried and only the outer
     * side of the sleeve shows - which is what a shoulder looks like. */
    const torsoProfile = [
      V3(T.botR * 0.88, T.yBot, 0),
      V3(T.botR * 1.00, T.yBot + 0.040, 0),
      V3(T.topR * 0.94, T.yBot + 0.115, 0),
      V3(T.topR * 1.00, T.yBot + 0.215, 0),
      V3(T.shoulderR * 0.93, T.yTop - 0.105, 0),
      V3(T.shoulderR * 1.00, T.yTop - 0.070, 0),   // shoulder point
      /* The chest has to stay full right up to the collar. Rolling in from the
       * shoulder too early leaves the tie knot sitting in a hollow, and the
       * collar with nothing solid to lie on. */
      V3(T.shoulderR * 0.97, T.yTop - 0.040, 0),
      V3(T.shoulderR * 0.80, T.yTop - 0.016, 0),
      V3(T.topR * 0.42, T.yTop, 0)
    ];
    const torsoBody = B.MeshBuilder.CreateLathe('torsoBody', {
      shape: torsoProfile, tessellation: TSEG, cap: B.Mesh.CAP_ALL
    }, scene);
    torsoBody.material = mats.shirt;
    torsoBody.parent = torsoPivot;
    torsoBody.scaling.z = TD;

    /* Torso is a tapered cylinder, so anything worn on the chest has to be
     * placed against the radius AT ITS OWN HEIGHT - otherwise it sinks inside. */
    const torsoR = (y) => {
      for (let i = 1; i < torsoProfile.length; i++) {
        const a = torsoProfile[i - 1], b = torsoProfile[i];
        if (y <= b.y) {
          const f = (y - a.y) / Math.max(0.001, b.y - a.y);
          return (a.x + (b.x - a.x) * Math.max(0, Math.min(1, f))) * TD;
        }
      }
      return torsoProfile[torsoProfile.length - 1].x * TD;
    };
    // sit a chest detail on the surface, sunk `embed` deep so no seam shows
    const onChest = (y, embed) => V3(0, y, torsoR(y) - (embed || 0.012));

    /* Collar: a band flaring from the neck out to the shoulders, plus two
     * points forming a V around the knot. Two loose tabs on the chest read as
     * notches cut in the shirt rather than as a collar. */
    // Sits slightly ABOVE the shoulder line and flares hard: on the reference
    // the collar swallows the neck almost entirely, and a band level with the
    // shirt top leaves a bare skin column between chin and shoulders.
    const bandY = T.yTop + 0.012;
    const band = cyl("collarBand", C.neck.r * 2.16, T.topR * 1.30, 0.046, 24);
    band.material = mats.shirt;   // shaded, it read as a cream ring under the chin
    band.parent = torsoPivot;
    band.position.y = bandY;

    [-1, 1].forEach((side) => {
      // Down on the flat of the chest, not up on the shoulder slope: a straight
      // box spanning that slope sticks its top clean out of the shirt and reads
      // as a paper wing.
      const y = T.yTop - 0.050;
      const pt = box("collarPt" + (side < 0 ? "L" : "R"), 0.030, 0.062, 0.015);
      pt.material = mats.shirt;
      pt.parent = torsoPivot;
      pt.position.set(side * 0.041, y, torsoR(y) - 0.005);
      // top inward at the neck, tip down and out - the way a collar point hangs
      pt.rotation.z = side * deg(22);
      pt.rotation.x = deg(6);
    });

    /* Necktie. Three separate boxes at fixed depths visibly step apart as the
     * torso tapers, so the blade is ONE ribbon whose vertices are wrapped onto
     * the chest at whatever radius the torso has at each height. */
    const knotY = T.yTop - 0.040;
    const knot = box('tieKnot', 0.054, 0.058, 0.034);
    knot.material = mats.tie;
    knot.parent = torsoPivot;
    knot.position.copyFrom(onChest(knotY, 0.010));
    knot.rotation.x = deg(6);

    const tieTop = knotY - 0.016;                 // starts inside the knot
    const tieBot = T.yTop - 0.292;                // stops clear of the shirt hem
    const STEPS = 26;
    const edgeL = [], edgeR = [];
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      const y = tieTop + (tieBot - tieTop) * f;
      // narrow under the knot, widening down the blade, then mitred to a point
      const w = f > 0.88
        ? 0.074 * (1 - (f - 0.88) / 0.12) + 0.004
        : 0.052 + 0.022 * Math.pow(f / 0.88, 0.8);
      const rad = torsoR(y) + 0.006;              // just proud enough to stay visible
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
    const thumbs = {};
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
      const cuff = cyl("cuff" + tag, A.r * 2.08, A.r * 2.12, 0.026, 16);
      cuff.material = mats.shirt;
      cuff.parent = pivot;
      cuff.position.y = -A.len + 0.018;

      const hand = sph('hand' + tag, C.hand.r * 2, 14);
      hand.scaling.set(1, 0.92, 0.95);
      hand.material = mats.skin;
      hand.parent = pivot;
      hand.position.y = -A.len - 0.010;

      /* Thumb for the thumbs-up emote, hidden the rest of the time - these are
       * mitten hands and a permanent thumb would read oddly at rest.
       * Parented to the arm pivot, not the hand, so it doesn't inherit the
       * hand's non-uniform scaling. */
      const thumb = B.MeshBuilder.CreateCapsule('thumb' + tag, {
        radius: C.hand.thumbR, height: C.hand.thumbLen, tessellation: 10
      }, scene);
      thumb.material = mats.skin;
      thumb.parent = pivot;
      // `up` is the pivot-local direction that becomes world-up once the arm is
      // pitched to thumbPoseX. Offsetting along it by more than the hand radius
      // is what keeps the thumb from sitting buried inside the fist.
      const tp = -C.hand.thumbPoseX;
      const up = V3(0, Math.cos(tp), Math.sin(tp));
      const reach = C.hand.r * 0.95 + C.hand.thumbLen * 0.30;
      thumb.position.copyFrom(
        V3(side * 0.028, -A.len - 0.028, 0).add(up.scale(reach)));
      thumb.rotation.x = tp;                    // cancels the emote's arm pitch
      thumb.isVisible = false;
      thumbs[side < 0 ? 'L' : 'R'] = thumb;

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
      // Keyed off the shoe height, so the hem always lands just above the
      // high-top's collar instead of being swallowed by it.
      const hem = cyl('hem' + tag, L.r * 2.16, L.r * 2.10, 0.032, 16);
      hem.material = mats.trouser;
      hem.parent = pivot;
      hem.position.y = -L.len + S.h * 1.12;

      /* High-top sneaker, leg-local: white rubber sole wrapping a black canvas
       * upper, with a white toe cap. Rounded volumes throughout - a flat slab
       * sole reads as an ice skate. */
      const ankleY = -L.len;

      // black canvas upper, rounded and slightly longer than it is wide
      const upper = sph('shoeUpper' + tag, 1, 16);
      upper.scaling.set(S.w, S.h * 0.96, S.d);
      upper.material = mats.shoe;
      upper.parent = pivot;
      upper.position.set(0, ankleY + S.h * 0.47, S.toeOut);

      // rubber sole: a flattened sphere so it curves up at heel and toe
      const sole = sph('shoeSole' + tag, 1, 16);
      sole.scaling.set(S.w * 0.97, S.soleT * 1.30, S.d * 0.98);
      sole.material = mats.sole;
      sole.parent = pivot;
      sole.position.set(0, ankleY + S.soleT * 0.42, S.toeOut);

      /* White toe cap. It has to be NARROWER than the upper: at full width it
       * sits where the upper has already curved inward and squeezes out past
       * the silhouette as a white bulge instead of reading as a cap. */
      const toe = sph('shoeToe' + tag, 1, 14);
      toe.scaling.set(S.w * 0.88, S.h * 0.52, S.d * 0.44);
      toe.material = mats.sole;
      toe.parent = pivot;
      toe.position.set(0, ankleY + S.h * 0.36, S.toeOut + S.d * 0.28);

      // Three shallow lace bands give the rounded high-top a readable sneaker
      // face. Seated against the upper's own curve - at a flat depth they
      // float off the front of the shoe.
      for (let i = 0; i < 3; i++) {
        const ly = S.h * (0.30 + i * 0.105);
        const v  = (ly - S.h * 0.47) / (S.h * 0.48);            // up the ellipsoid
        const dz = (S.d / 2) * Math.sqrt(Math.max(0.05, 1 - v * v));
        const lace = box('shoeLace' + tag + i, S.w * 0.46, 0.011, 0.010);
        lace.material = mats.sole;
        lace.parent = pivot;
        lace.position.set(0, ankleY + ly, S.toeOut + dz * 0.94);
      }

      // padded ankle collar, sitting around the top of the high-top
      /* Padded ankle collar - a ring AROUND the ankle, so it stays in the XZ
       * plane the torus is already built in. Standing it up on its edge turned
       * it into a hoop running up the shin, and that single mesh was most of
       * why the shoe measured two thirds taller than the reference. */
      const collar = B.MeshBuilder.CreateTorus('shoeAnkle' + tag, {
        diameter: L.r * 1.94, thickness: 0.024, tessellation: 16
      }, scene);
      collar.material = mats.shoe;
      collar.parent = pivot;
      collar.position.set(0, ankleY + S.h * 0.86, S.toeOut - S.d * 0.08);
      return pivot;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    /* ------------------------------------------------------------- tidy up */
    const meshes = root.getChildMeshes();
    meshes.forEach((m) => { m.isPickable = false; });

    // report the true silhouette so callers can frame the camera correctly
    let minY = Infinity, maxY = -Infinity;
    meshes.forEach((m) => {
      /* The hair is vertex-displaced and then flat-shaded, and both leave the
       * builder's original bounds in place, so the reported height came out
       * ~3% short - and `height` is what main.js sizes the follow camera from.
       * Refresh has to come FIRST: it rebuilds the local box, and only the
       * following computeWorldMatrix re-projects that into world space. */
      m.refreshBoundingInfo();
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
      armL, armR, legL, legR, thumbs,
      cfg: C, mats, meshes,
      height: maxY - minY,
      groundOffset: root.position.y,      // root Y that rests the soles on 0
      contact: contactBlob,
      parts: { head, hair, eyeL, eyeR, nose, mouth, neck, torsoBody }
    };
  }

  global.createCharacter = createCharacter;
})(window);
