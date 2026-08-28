/*
 * English Land - prop library for the base camp.
 *
 * Every builder appends its meshes to `kit.meshes` and registers collision:
 *
 *   kit.solid(x, z, r)              circle that always blocks
 *   kit.solidBox(x, z, hw, hd)      axis-aligned box that always blocks
 *   kit.platform(x, z, hw, hd, top) box you can stand on, and which only
 *                                   blocks while you are BELOW its top - this
 *                                   is what makes a prop jumpable
 *
 * Props are static, so world.js merges them by material at the end. Anything
 * that animates (fire, water) is tagged `dynamic` and skipped by the merge.
 */
(function (global) {
  'use strict';
  const B = global.BABYLON;

  const PALETTE = {
    trunk:     '#8b5e3c',
    trunkDark: '#6f4a2f',
    pineA:     '#2f7a45',
    pineB:     '#3d9455',
    leafA:     '#5cb85a',
    leafB:     '#7ac96a',
    bush:      '#67bf5f',

    wall:      '#f6e7c9',
    wallTrim:  '#e6d2ab',
    roof:      '#cc6f47',
    roofDark:  '#a95534',
    door:      '#c4462f',
    doorDark:  '#9c3624',
    glass:     '#93d4ea',
    white:     '#fbfaf6',

    wood:      '#d8a869',
    woodDark:  '#b3814a',
    plank:     '#e2c188',

    red:       '#e2574c',
    yellow:    '#f4c53f',
    pink:      '#f191b5',
    purple:    '#9d7ad9',
    orange:    '#f08a3c',
    blue:      '#4aa8d8',
    teal:      '#3fbfae',

    stone:     '#b9b3a8',
    stoneDark: '#8f8877',
    metal:     '#7d8794',
    soil:      '#7d5a3c',
    sand:      '#efdda4',
    poolWall:  '#eaf4f7',
    poolWater: '#57c6e6',
    flameA:    '#ff8a3d',
    flameB:    '#ffd24a'
  };

  function createPropKit(scene) {
    const hex = (s) => B.Color3.FromHexString(s);
    const mats = {};
    const mat = (name, colHex, opts) => {
      if (mats[name]) return mats[name];
      const m = new B.StandardMaterial('m_' + name, scene);
      m.diffuseColor = hex(colHex);
      m.specularColor = new B.Color3(0.03, 0.03, 0.03);
      if (opts && opts.emissive) m.emissiveColor = hex(colHex).scale(opts.emissive);
      if (opts && opts.alpha !== undefined) m.alpha = opts.alpha;
      mats[name] = m;
      return m;
    };
    // pre-create the palette so merging can group by a stable material
    for (const k in PALETTE) mat(k, PALETTE[k]);

    const kit = {
      mats, PALETTE,
      meshes: [],       // static, merged later
      dynamic: [],      // animated, left alone
      solids: [],
      platforms: [],
      casters: []       // props big enough to be worth a shadow
    };

    /* ------------------------------------------------------------ helpers */
    const add = (m, matName, caster) => {
      m.material = mats[matName];
      m.isPickable = false;
      kit.meshes.push(m);
      if (caster) kit.casters.push(m);
      return m;
    };
    const box = (n, w, h, d) => B.MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    const cyl = (n, dT, dB, h, t) => B.MeshBuilder.CreateCylinder(n,
      { diameterTop: dT, diameterBottom: dB, height: h, tessellation: t || 12 }, scene);
    const sph = (n, d, s) => B.MeshBuilder.CreateSphere(n, { diameter: d, segments: s || 8 }, scene);

    kit.solid    = (x, z, r) => kit.solids.push({ kind: 'circle', x, z, r });
    kit.solidBox = (x, z, hw, hd) => kit.solids.push({ kind: 'box', x, z, hw, hd });
    kit.platform = (x, z, hw, hd, top) => kit.platforms.push({ x, z, hw, hd, top });

    /* -------------------------------------------------------------- trees */
    kit.pine = (x, z, s, ry) => {
      s = s || 1; ry = ry || 0;
      const t = cyl('pt', 0.26 * s, 0.34 * s, 1.0 * s, 8);
      t.position.set(x, 0.5 * s, z); add(t, 'trunk', true);
      const tiers = [
        { y: 1.05, d: 2.15, h: 1.30, c: 'pineA' },
        { y: 1.85, d: 1.70, h: 1.20, c: 'pineB' },
        { y: 2.60, d: 1.15, h: 1.05, c: 'pineA' }
      ];
      tiers.forEach((tr, i) => {
        const c = cyl('pc' + i, 0, tr.d * s, tr.h * s, 8);
        c.position.set(x, tr.y * s, z);
        c.rotation.y = ry + i * 0.4;
        add(c, tr.c, true);
      });
      kit.solid(x, z, 0.45 * s);
    };

    kit.roundTree = (x, z, s, ry, leaf) => {
      s = s || 1; ry = ry || 0; leaf = leaf || 'leafA';
      const t = cyl('rt', 0.24 * s, 0.32 * s, 1.25 * s, 8);
      t.position.set(x, 0.62 * s, z); add(t, 'trunk', true);
      const blobs = [[0, 1.95, 0, 1.85], [-0.45, 1.70, 0.20, 1.30],
                     [0.48, 1.72, -0.18, 1.25], [0.05, 2.45, -0.10, 1.10]];
      blobs.forEach((b, i) => {
        const c = sph('rc' + i, b[3] * s, 8);
        c.position.set(x + b[0] * s, b[1] * s, z + b[2] * s);
        c.rotation.y = ry;
        add(c, i % 2 ? leaf : (leaf === 'leafA' ? 'leafB' : 'leafA'), true);
      });
      kit.solid(x, z, 0.42 * s);
    };

    kit.bush = (x, z, s) => {
      s = s || 1;
      [[0, 0, 0.9], [-0.3, -0.05, 0.7], [0.32, 0.02, 0.66]].forEach((b, i) => {
        const c = sph('bs' + i, b[2] * s, 8);
        c.scaling.y = 0.8;
        c.position.set(x + b[0] * s, 0.32 * s + b[1], z + b[1] * s);
        add(c, i % 2 ? 'bush' : 'leafA', false);
      });
      kit.solid(x, z, 0.42 * s);
    };

    /* ------------------------------------------------------------ flowers */
    kit.flower = (x, z, colour, s) => {
      s = s || 1;
      const stem = cyl('fs', 0.035 * s, 0.045 * s, 0.30 * s, 5);
      stem.position.set(x, 0.15 * s, z); add(stem, 'leafA', false);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = sph('fp', 0.17 * s, 6);
        p.scaling.y = 0.45;
        p.position.set(x + Math.cos(a) * 0.10 * s, 0.33 * s, z + Math.sin(a) * 0.10 * s);
        add(p, colour, false);
      }
      const c = sph('fc', 0.10 * s, 6);
      c.position.set(x, 0.36 * s, z); add(c, 'yellow', false);
    };

    kit.flowerBed = (x, z, w, d, colours) => {
      const cols = colours || ['red', 'yellow', 'pink', 'purple'];
      let i = 0;
      for (let ix = -w / 2; ix <= w / 2; ix += 0.62) {
        for (let iz = -d / 2; iz <= d / 2; iz += 0.62) {
          kit.flower(x + ix + (Math.random() - 0.5) * 0.12,
                     z + iz + (Math.random() - 0.5) * 0.12,
                     cols[i++ % cols.length], 0.85 + Math.random() * 0.3);
        }
      }
    };

    /* -------------------------------------------------------------- fence */
    kit.fenceRun = (x1, z1, x2, z2) => {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / 1.1));
      const ang = Math.atan2(dx, dz);
      for (let i = 0; i <= n; i++) {
        const px = x1 + dx * (i / n), pz = z1 + dz * (i / n);
        const p = box('fp', 0.13, 0.86, 0.13);
        p.position.set(px, 0.43, pz);
        p.rotation.y = ang;
        add(p, 'wood', true);
      }
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = x1 + dx * t, pz = z1 + dz * t;
        [0.34, 0.62].forEach((h) => {
          const r = box('fr', 0.06, 0.10, len / n);
          r.position.set(px, h, pz);
          r.rotation.y = ang;
          add(r, 'plank', false);
        });
      }
      // one collider per segment, so the run blocks along its whole length
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        kit.solid(x1 + dx * t, z1 + dz * t, 0.30);
      }
    };

    /* -------------------------------------------------------------- house */
    kit.house = (x, z, ry) => {
      ry = ry || 0;
      const W = 4.4, D = 3.6, Hh = 2.5;
      const node = new B.TransformNode('houseNode', scene);

      const body = box('hw', W, Hh, D);
      body.position.set(x, Hh / 2, z); body.rotation.y = ry; add(body, 'wall', true);

      const base = box('hb', W + 0.16, 0.26, D + 0.16);
      base.position.set(x, 0.13, z); base.rotation.y = ry; add(base, 'wallTrim', true);

      // hip roof: a 4-sided pyramid, turned 45 degrees so a face points front
      const roof = cyl('hr', 0, (W + 1.5) * 0.76, 1.75, 4);
      roof.position.set(x, Hh + 0.86, z);
      roof.rotation.y = ry + Math.PI / 4;
      add(roof, 'roof', true);

      const eave = cyl('he', (W + 1.2) * 0.74, (W + 1.4) * 0.78, 0.20, 4);
      eave.position.set(x, Hh + 0.08, z);
      eave.rotation.y = ry + Math.PI / 4;
      add(eave, 'roofDark', true);

      // door, set into the front face (+Z before rotation)
      const fz = Math.cos(ry) * (D / 2 + 0.02), fx = Math.sin(ry) * (D / 2 + 0.02);
      const door = box('hd', 0.95, 1.55, 0.10);
      door.position.set(x + fx, 0.78, z + fz); door.rotation.y = ry; add(door, 'door', false);
      // half-round top, flattened against the wall, to arch the doorway
      const archTop = sph('hat', 0.95, 10);
      archTop.scaling.set(1, 0.55, 0.11);
      archTop.position.set(x + fx, 1.56, z + fz);
      archTop.rotation.y = ry;
      add(archTop, 'door', false);

      const knob = sph('hk', 0.14, 6);
      knob.position.set(x + fx * 1.06 + Math.cos(ry) * 0.30, 0.86, z + fz * 1.06 - Math.sin(ry) * 0.30);
      add(knob, 'yellow', false);

      // windows on the front, either side of the door
      [-1.45, 1.45].forEach((off) => {
        const wx = x + fx + Math.cos(ry) * off;
        const wz = z + fz - Math.sin(ry) * off;
        const fr = box('hwf', 0.92, 0.92, 0.08);
        fr.position.set(wx, 1.62, wz); fr.rotation.y = ry; add(fr, 'white', false);
        const gl = box('hwg', 0.74, 0.74, 0.06);
        gl.position.set(wx + Math.sin(ry) * 0.03, 1.62, wz + Math.cos(ry) * 0.03);
        gl.rotation.y = ry; add(gl, 'glass', false);
      });

      // step
      const st = box('hs', 1.5, 0.16, 0.6);
      st.position.set(x + fx * 1.20, 0.08, z + fz * 1.20); st.rotation.y = ry;
      add(st, 'stone', false);

      node.dispose();
      kit.solidBox(x, z, W / 2 + 0.25, D / 2 + 0.25);
      return { x, z, frontX: x + fx * 1.6, frontZ: z + fz * 1.6 };
    };

    kit.mailbox = (x, z, ry) => {
      ry = ry || 0;
      const p = cyl('mp', 0.11, 0.13, 0.85, 8);
      p.position.set(x, 0.42, z); add(p, 'woodDark', true);
      const b = box('mb', 0.42, 0.34, 0.56);
      b.position.set(x, 1.02, z); b.rotation.y = ry; add(b, 'red', true);
      const top = cyl('mt', 0.42, 0.42, 0.56, 10);
      top.rotation.set(0, ry, Math.PI / 2);
      top.position.set(x, 1.19, z); add(top, 'red', false);
      const flag = box('mf', 0.06, 0.30, 0.14);
      flag.position.set(x + Math.cos(ry) * 0.24, 1.28, z - Math.sin(ry) * 0.24);
      add(flag, 'yellow', false);
      kit.solid(x, z, 0.32);
    };

    kit.sign = (x, z, ry) => {
      ry = ry || 0;
      [-0.32, 0.32].forEach((o) => {
        const p = box('sp', 0.11, 1.05, 0.11);
        p.position.set(x + Math.cos(ry) * o, 0.52, z - Math.sin(ry) * o);
        p.rotation.y = ry; add(p, 'woodDark', false);
      });
      const bd = box('sb', 1.05, 0.80, 0.10);
      bd.position.set(x, 1.18, z); bd.rotation.y = ry; add(bd, 'woodDark', true);
      const face = box('sf', 0.88, 0.64, 0.06);
      face.position.set(x + Math.sin(ry) * 0.05, 1.18, z + Math.cos(ry) * 0.05);
      face.rotation.y = ry; add(face, 'stoneDark', false);
      kit.solid(x, z, 0.40);
    };

    /* ------------------------------------------------- table, chairs, etc */
    kit.table = (x, z) => {
      const top = cyl('tt', 1.55, 1.55, 0.14, 16);
      top.position.set(x, 0.76, z); add(top, 'plank', true);
      const post = cyl('tp', 0.16, 0.20, 0.72, 8);
      post.position.set(x, 0.38, z); add(post, 'metal', false);
      const foot = cyl('tf', 0.70, 0.80, 0.07, 12);
      foot.position.set(x, 0.04, z); add(foot, 'metal', false);
      kit.solid(x, z, 0.80);
    };

    kit.chair = (x, z, ry) => {
      ry = ry || 0;
      const seat = cyl('cs', 0.62, 0.62, 0.10, 12);
      seat.position.set(x, 0.46, z); add(seat, 'plank', true);
      const back = box('cb', 0.60, 0.55, 0.08);
      back.position.set(x - Math.sin(ry) * 0.26, 0.76, z - Math.cos(ry) * 0.26);
      back.rotation.y = ry; add(back, 'plank', false);
      for (let i = 0; i < 4; i++) {
        const a = ry + Math.PI / 4 + i * Math.PI / 2;
        const l = cyl('cl', 0.06, 0.06, 0.46, 6);
        l.position.set(x + Math.cos(a) * 0.22, 0.23, z + Math.sin(a) * 0.22);
        add(l, 'metal', false);
      }
      kit.solid(x, z, 0.36);
    };

    kit.birdbath = (x, z) => {
      const p = cyl('bp', 0.22, 0.34, 0.85, 10);
      p.position.set(x, 0.42, z); add(p, 'stone', true);
      const bowl = cyl('bb', 0.92, 0.62, 0.22, 14);
      bowl.position.set(x, 0.95, z); add(bowl, 'stone', true);
      const w = cyl('bw', 0.76, 0.76, 0.06, 14);
      w.position.set(x, 1.03, z); add(w, 'poolWater', false);
      kit.solid(x, z, 0.42);
    };

    kit.campfire = (x, z) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = sph('cf', 0.30 + Math.random() * 0.1, 6);
        s.scaling.y = 0.7;
        s.position.set(x + Math.cos(a) * 0.55, 0.10, z + Math.sin(a) * 0.55);
        add(s, 'stone', false);
      }
      [0, 1].forEach((i) => {
        const l = cyl('cl', 0.15, 0.17, 0.95, 7);
        l.rotation.set(Math.PI / 2 - 0.25, i * 1.3, 0);
        l.position.set(x, 0.18, z);
        add(l, 'trunkDark', false);
      });
      // flames animate, so they stay out of the merge
      const flames = [];
      [[0, 0.52, 0.44, 'flameA'], [0.10, 0.72, 0.30, 'flameB']].forEach((f, i) => {
        const c = cyl('flame' + i, 0, f[2], f[1], 7);
        c.position.set(x + f[0], 0.28 + f[1] / 2, z);
        c.material = mat(f[3], PALETTE[f[3]], { emissive: 0.85 });
        c.isPickable = false;
        kit.dynamic.push({ mesh: c, kind: 'flame', baseY: c.position.y, seed: i * 2.1 });
        flames.push(c);
      });
      kit.solid(x, z, 0.70);
    };

    /* ---------------------------------------------------------- playground */
    kit.sandbox = (x, z, w, d) => {
      const h = 0.34;
      [[0, -d / 2, w + 0.4, 0.4], [0, d / 2, w + 0.4, 0.4],
       [-w / 2, 0, 0.4, d], [w / 2, 0, 0.4, d]].forEach((r) => {
        const b = box('sbr', r[2], h, r[3]);
        b.position.set(x + r[0], h / 2, z + r[1]);
        add(b, 'blue', true);
      });
      const sand = box('sbs', w, 0.24, d);
      sand.position.set(x, 0.14, z); add(sand, 'sand', false);
      // little sand mound and a spade
      const mound = sph('sbm', 0.85, 8);
      mound.scaling.y = 0.5;
      mound.position.set(x + 0.2, 0.30, z); add(mound, 'sand', false);
      const sp = box('sbp', 0.10, 0.55, 0.05);
      sp.rotation.z = 0.5;
      sp.position.set(x - 0.5, 0.46, z + 0.3); add(sp, 'red', false);
      // the rim is low enough to hop onto
      kit.platform(x, z - d / 2, (w + 0.4) / 2, 0.2, h);
      kit.platform(x, z + d / 2, (w + 0.4) / 2, 0.2, h);
      kit.platform(x - w / 2, z, 0.2, d / 2, h);
      kit.platform(x + w / 2, z, 0.2, d / 2, h);
    };

    kit.swing = (x, z, ry) => {
      ry = ry || 0;
      const H = 2.3, span = 2.2;
      [-1, 1].forEach((side) => {
        [-1, 1].forEach((lean) => {
          const l = cyl('swl', 0.13, 0.15, H, 8);
          l.rotation.set(lean * 0.22, ry, 0);
          l.position.set(x + Math.cos(ry) * side * span / 2,
                         H / 2, z - Math.sin(ry) * side * span / 2 + lean * 0.25);
          add(l, 'metal', true);
        });
      });
      const bar = cyl('swb', 0.13, 0.13, span + 0.3, 8);
      bar.rotation.set(0, 0, Math.PI / 2);
      bar.rotation.y = ry;
      bar.position.set(x, H - 0.06, z); add(bar, 'metal', true);
      // seat on two ropes
      [-0.28, 0.28].forEach((o) => {
        const r = cyl('swr', 0.045, 0.045, 1.35, 6);
        r.position.set(x + Math.cos(ry) * o, H - 0.72, z - Math.sin(ry) * o);
        add(r, 'woodDark', false);
      });
      const seat = box('sws', 0.75, 0.10, 0.34);
      seat.position.set(x, H - 1.42, z); seat.rotation.y = ry;
      add(seat, 'red', true);
      kit.solid(x + Math.cos(ry) * span / 2, z - Math.sin(ry) * span / 2, 0.30);
      kit.solid(x - Math.cos(ry) * span / 2, z + Math.sin(ry) * span / 2, 0.30);
    };

    /* A little climbing frame: two steps up to a deck, and a slide down.
     * Every level is a platform, so it is genuinely climbable. */
    kit.slide = (x, z, ry) => {
      ry = ry || 0;
      const dirX = Math.sin(ry), dirZ = Math.cos(ry);   // "down the slide"
      const deckY = 1.05;

      const deck = box('sld', 1.20, 0.18, 1.20);
      deck.position.set(x, deckY, z); deck.rotation.y = ry;
      add(deck, 'plank', true);
      kit.platform(x, z, 0.62, 0.62, deckY + 0.09);

      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
        const l = cyl('sll', 0.12, 0.14, deckY, 8);
        l.position.set(x + sx * 0.48, deckY / 2, z + sz * 0.48);
        add(l, 'metal', false);
      }));

      // steps on the back side
      [[0.42, -1.05], [0.74, -1.72]].forEach((s) => {
        const sx = x + dirX * s[1], sz = z + dirZ * s[1];
        const st = box('sls', 1.0, 0.16, 0.52);
        st.position.set(sx, s[0], sz);
        st.rotation.y = ry;
        add(st, 'plank', true);
        kit.platform(sx, sz, 0.52, 0.28, s[0] + 0.08);
      });

      /* The ramp. Rotating +0.46 about X drops the far (+Z) end, so the slide
       * descends away from the deck; a negative angle raises it instead and
       * the slide runs uphill. */
      const ramp = box('slr', 0.95, 0.12, 2.35);
      ramp.rotation.set(0.46, ry, 0);
      ramp.position.set(x + dirX * 1.20, 0.56, z + dirZ * 1.20);
      add(ramp, 'yellow', true);
      [-1, 1].forEach((sx) => {
        const rail = box('slk', 0.10, 0.28, 2.35);
        rail.rotation.set(0.46, ry, 0);
        rail.position.set(x + dirX * 1.20 + Math.cos(ry) * sx * 0.50, 0.66,
                          z + dirZ * 1.20 - Math.sin(ry) * sx * 0.50);
        add(rail, 'orange', false);
      });
    };

    /* -------------------------------------------------------------- pool */
    kit.pool = (x, z, w, d) => {
      const h = 0.52, t = 0.34;
      [[0, -d / 2 - t / 2, w + t * 2, t], [0, d / 2 + t / 2, w + t * 2, t],
       [-w / 2 - t / 2, 0, t, d], [w / 2 + t / 2, 0, t, d]].forEach((r) => {
        const b = box('plr', r[2], h, r[3]);
        b.position.set(x + r[0], h / 2, z + r[1]);
        add(b, 'poolWall', true);
        kit.platform(x + r[0], z + r[1], r[2] / 2, r[3] / 2, h);
      });
      // liner + surface. The surface animates, so it is not merged.
      const liner = box('pll', w, 0.30, d);
      liner.position.set(x, 0.15, z); add(liner, 'teal', false);
      const surf = B.MeshBuilder.CreateGround('poolSurf', { width: w, height: d }, scene);
      const sm = new B.StandardMaterial('poolSurfMat', scene);
      sm.diffuseColor = hex(PALETTE.poolWater);
      sm.emissiveColor = hex(PALETTE.poolWater).scale(0.25);
      sm.specularColor = new B.Color3(0.5, 0.5, 0.5);
      sm.specularPower = 64;
      sm.alpha = 0.86;
      surf.material = sm;
      surf.position.set(x, 0.34, z);
      surf.isPickable = false;
      kit.dynamic.push({ mesh: surf, kind: 'pool', baseY: 0.34 });
      // standing in the pool puts you just below the rim
      kit.platform(x, z, w / 2, d / 2, 0.30);

      // a ring buoy on the deck
      const ring = B.MeshBuilder.CreateTorus('plb',
        { diameter: 0.72, thickness: 0.20, tessellation: 12 }, scene);
      ring.position.set(x + w / 2 + 0.95, 0.10, z - d / 2 + 0.4);
      ring.rotation.x = Math.PI / 2;
      add(ring, 'red', false);
    };

    /* ------------------------------------------------- jumpable furniture */
    kit.crate = (x, z, s, ry) => {
      s = s || 1; ry = ry || 0;
      const h = 0.62 * s;
      const b = box('cr', 0.78 * s, h, 0.78 * s);
      b.position.set(x, h / 2, z); b.rotation.y = ry; add(b, 'wood', true);
      const band = box('crb', 0.82 * s, 0.10 * s, 0.82 * s);
      band.position.set(x, h * 0.72, z); band.rotation.y = ry; add(band, 'woodDark', false);
      kit.platform(x, z, 0.42 * s, 0.42 * s, h);
    };

    kit.stump = (x, z, s) => {
      s = s || 1;
      const h = 0.46 * s;
      const b = cyl('st', 0.72 * s, 0.82 * s, h, 10);
      b.position.set(x, h / 2, z); add(b, 'trunk', true);
      const top = cyl('stt', 0.66 * s, 0.66 * s, 0.06, 10);
      top.position.set(x, h + 0.01, z); add(top, 'plank', false);
      kit.platform(x, z, 0.38 * s, 0.38 * s, h + 0.04);
    };

    kit.stone = (x, z, s) => {
      s = s || 1;
      const h = 0.18;
      const b = cyl('sn', 0.86 * s, 0.94 * s, h, 9);
      b.position.set(x, h / 2, z); add(b, 'stone', false);
      kit.platform(x, z, 0.44 * s, 0.44 * s, h);
    };

    kit.lamp = (x, z) => {
      const p = cyl('lp', 0.10, 0.14, 2.05, 8);
      p.position.set(x, 1.02, z); add(p, 'metal', true);
      const head = cyl('lh', 0.46, 0.30, 0.40, 8);
      head.position.set(x, 2.20, z); add(head, 'metal', false);
      const glow = sph('lg', 0.34, 8);
      glow.position.set(x, 2.06, z);
      glow.material = mat('lampGlow', PALETTE.yellow, { emissive: 1.0 });
      glow.isPickable = false;
      kit.meshes.push(glow);
      kit.solid(x, z, 0.24);
    };

    kit.planter = (x, z, w, d, colours) => {
      const h = 0.42;
      const b = box('pl', w, h, d);
      b.position.set(x, h / 2, z); add(b, 'wood', true);
      const rim = box('plr2', w + 0.12, 0.10, d + 0.12);
      rim.position.set(x, h, z); add(rim, 'plank', false);
      const soil = box('pls', w - 0.16, 0.08, d - 0.16);
      soil.position.set(x, h + 0.02, z); add(soil, 'soil', false);
      const cols = colours || ['red', 'yellow', 'pink'];
      let i = 0;
      for (let ix = -(w / 2) + 0.42; ix < w / 2 - 0.2; ix += 0.55) {
        for (let iz = -(d / 2) + 0.38; iz < d / 2 - 0.2; iz += 0.55) {
          const f = sph('plf', 0.26, 6);
          f.scaling.y = 0.8;
          f.position.set(x + ix, h + 0.18, z + iz);
          add(f, cols[i++ % cols.length], false);
        }
      }
      kit.solidBox(x, z, w / 2 + 0.05, d / 2 + 0.05);
    };

    kit.ball = (x, z, colour) => {
      const b = sph('bl', 0.52, 10);
      b.position.set(x, 0.26, z); add(b, colour || 'red', true);
      kit.solid(x, z, 0.28);
    };

    kit.bench = (x, z, ry) => {
      ry = ry || 0;
      const seat = box('bn', 1.85, 0.14, 0.58);
      seat.position.set(x, 0.48, z); seat.rotation.y = ry; add(seat, 'plank', true);
      const back = box('bnb', 1.85, 0.50, 0.10);
      back.position.set(x - Math.sin(ry) * 0.26, 0.78, z - Math.cos(ry) * 0.26);
      back.rotation.y = ry; add(back, 'plank', false);
      [-0.75, 0.75].forEach((o) => {
        const l = box('bnl', 0.12, 0.48, 0.48);
        l.position.set(x + Math.cos(ry) * o, 0.24, z - Math.sin(ry) * o);
        l.rotation.y = ry; add(l, 'metal', false);
      });
      kit.platform(x, z, 0.95, 0.32, 0.55);
    };

    return kit;
  }

  global.createPropKit = createPropKit;
  global.PROP_PALETTE = PALETTE;
})(window);
