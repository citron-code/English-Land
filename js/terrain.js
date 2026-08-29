/*
 * English Land - terrain.
 *
 * The island is a HEIGHT FIELD rather than a flat disc: one analytic function
 * `heightAt(x, z)` defines everything, and three things read from it, so they
 * can never disagree:
 *
 *   1. the terrain mesh   (a grid, sampled per vertex)
 *   2. the ground texture (cliff bands and the river are drawn from the same
 *                          shape definitions, as vectors, so edges stay crisp)
 *   3. collision          (groundAt is literally heightAt; walls are places
 *                          where it rises faster than the player can step)
 *
 * Terrace edges are deliberately steep but NOT vertical. A perfectly vertical
 * wall has zero footprint in a planar UV projection, so the texture smears
 * infinitely across it. A transition ~0.7 units wide gives the cliff a real
 * band of texture to sample.
 */
(function (global) {
  'use strict';
  const B = global.BABYLON;

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // 1 when v is past `a`, 0 before `b`, smooth between
  const smooth = (a, b, v) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  function createTerrain(opts) {
    const S = opts.size, HALF = S / 2;

    /* --------------------------------------------------------------- shapes
     * Defined once. Both the mesh and the texture painter read these. */
    const SH = {
      plateauH: 2.45,
      // the upper terrace, as a union of circles - gives an organic outline
      plateau: [
        { x: -6.6, z: 8.2, r: 5.0 },
        { x: -2.6, z: 6.4, r: 3.1 },
        { x: -9.6, z: 4.6, r: 3.0 },
        { x: -4.2, z: 10.4, r: 3.2 }
      ],
      /* Width of the slope from base to plateau. This has to be steep enough
       * that a walking player gains more than STEP_UP per frame, or the cliff
       * is simply a ramp and they stroll up the face. Note the band is measured
       * along the surface NORMAL - approaching at an angle stretches the run
       * and softens the slope, so it needs headroom over the bare minimum. */
      cliffBand: 0.32,

      // Walkable incline up onto the plateau. Sited on the WEST flank, clear
      // of the river - the two cannot share a corridor.
      /* The incline must reach full height exactly where the terrace edge
       * begins (z ~ 1.6 along x = -9.4). Topping out later means the ramp is
       * still low when it runs into the plateau's own cliff band, leaving a
       * step partway up that nothing can climb. */
      ramp: { x: -9.4, z0: -2.8, z1: 1.8, w: 2.4, band: 0.32 },

      // river, carved relative to whatever the land height already is
      /* Stops just inside the shoreline. Run out past it and the water ribbon
       * hangs in the air over the sea. */
      river: [
        [-6.0, 11.8], [-4.6, 10.4], [-3.4, 8.6], [-2.4, 7.0],
        [-1.6, 4.4], [-0.6, 0.8], [0.6, -3.0], [2.0, -7.0],
        [3.4, -10.6], [4.2, -13.2]
      ],
      riverW: 1.25,             // half-width of the water channel
      riverBank: 0.62,          // slope from bank down to bed
      riverDepth: 1.05,

      /* Beyond the beach the land falls away to the sea. Making this part of
       * the height field gives the island its OWN shore, instead of a separate
       * cylinder whose top face z-fights through the terrain. */
      shoreR: 14.3, shoreFall: 1.5, shoreDrop: 3.0,

      /* Where the river crosses the terrace edge - i.e. the waterfall. Solved
       * from the shapes rather than eyeballed: see `findFall()` below. */
      fallAt: { x: 0, z: 0, ry: 0 }
    };

    /* ------------------------------------------------------------- helpers */
    // signed distance to the union of the plateau circles (negative inside)
    function plateauSDF(x, z) {
      let d = 1e9;
      for (let i = 0; i < SH.plateau.length; i++) {
        const c = SH.plateau[i];
        const dd = Math.hypot(x - c.x, z - c.z) - c.r;
        if (dd < d) d = dd;
      }
      return d;
    }

    // distance to the river polyline, plus how far along it we are (0..1)
    function riverDist(x, z) {
      let best = 1e9, bestT = 0, acc = 0, total = 0;
      const P = SH.river;
      for (let i = 0; i < P.length - 1; i++) {
        total += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      }
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz;
        let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
        t = clamp01(t);
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < best) { best = d; bestT = (acc + Math.sqrt(len2) * t) / total; }
        acc += Math.sqrt(len2);
      }
      return { d: best, t: bestT };
    }

    /* ------------------------------------------------------------ heightAt */
    function heightAt(x, z) {
      let h = 0;

      /* Upper terrace. LINEAR across the band, not smoothstep: smoothstep
       * flattens out at its base, and that shallow lip is walkable, so the
       * player strolls a metre up the cliff before it gets steep enough to
       * stop them. Constant slope also gives the crisp terrace crease the
       * reference art has. */
      const sd = plateauSDF(x, z);
      const up = clamp01((SH.cliffBand - sd) / SH.cliffBand);
      h = Math.max(h, up * SH.plateauH);

      // incline: a corridor climbing from z0 to z1
      const R = SH.ramp;
      const across = clamp01((R.w / 2 + R.band - Math.abs(x - R.x)) / (R.band * 2));
      const along = clamp01((z - R.z0) / (R.z1 - R.z0));
      // fade in/out at the ends so it meets the ground and the plateau cleanly
      const ends = smooth(R.z0 - 0.5, R.z0 + 0.4, z) * smooth(R.z1 + 0.9, R.z1 - 0.2, z);
      h = Math.max(h, across * ends * along * SH.plateauH);

      // river: carved RELATIVE to the land, so it stays a channel on both
      // levels and simply falls over the terrace edge in between
      const rv = riverDist(x, z);
      const inRiver = smooth(SH.riverW + SH.riverBank, SH.riverW, rv.d);
      h -= inRiver * SH.riverDepth;

      // shoreline: fall away to the sea past the beach
      const rr = Math.hypot(x, z);
      const off = smooth(SH.shoreR, SH.shoreR + SH.shoreFall, rr);
      h = h * (1 - off) - SH.shoreDrop * off;

      return h;
    }

    // gradient, for classifying cliff faces
    function slopeAt(x, z, e) {
      e = e || 0.22;
      const dx = heightAt(x + e, z) - heightAt(x - e, z);
      const dz = heightAt(x, z + e) - heightAt(x, z - e);
      return Math.hypot(dx, dz) / (2 * e);
    }

    /* --------------------------------------------------------------- mesh */
    function buildMesh(scene, name, cells) {
      const N = cells || 148;
      const step = S / N;
      const pos = [], idx = [], uv = [];
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const x = -HALF + i * step, z = -HALF + j * step;
          pos.push(x, heightAt(x, z), z);
          // planar UV, matching the 1:1 painted island texture
          uv.push((x + HALF) / S, (z + HALF) / S);
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i, b = a + 1, c = a + (N + 1), d = c + 1;
          /* Babylon is LEFT-handed: this winding is what puts the normals up.
           * Reversed, every normal points down, the whole surface is
           * backface-culled from above, and you see straight through the
           * island to whatever is underneath it. */
          idx.push(a, b, c, b, d, c);
        }
      }
      const mesh = new B.Mesh(name, scene);
      const vd = new B.VertexData();
      vd.positions = pos;
      vd.indices = idx;
      vd.uvs = uv;
      B.VertexData.ComputeNormals(pos, idx, vd.normals = []);
      vd.applyToMesh(mesh, false);
      mesh.isPickable = false;
      return mesh;
    }

    /* ------------------------------------------- texture painting helpers
     * Vector-drawn from the same shapes the height field uses, so cliff bands
     * land exactly where the geometry slopes. */
    function plateauPath(ctx, PX, PY, PW, grow) {
      ctx.beginPath();
      for (let i = 0; i < SH.plateau.length; i++) {
        const c = SH.plateau[i];
        ctx.moveTo(PX(c.x) + PW(c.r + grow), PY(c.z));
        ctx.arc(PX(c.x), PY(c.z), PW(c.r + grow), 0, Math.PI * 2);
      }
      ctx.closePath();
    }

    function rampPath(ctx, PX, PY, PW, grow) {
      const R = SH.ramp;
      const w = R.w / 2 + grow;
      ctx.beginPath();
      ctx.moveTo(PX(R.x - w), PY(R.z0 - grow));
      ctx.lineTo(PX(R.x + w), PY(R.z0 - grow));
      ctx.lineTo(PX(R.x + w), PY(R.z1 + grow));
      ctx.lineTo(PX(R.x - w), PY(R.z1 + grow));
      ctx.closePath();
    }

    function riverStroke(ctx, PX, PY, PW, width, colour) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = PW(width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      SH.river.forEach((p, i) => {
        const px = PX(p[0]), py = PY(p[1]);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
    }

    /* Walk the river polyline and find where it leaves the terrace, so the
     * waterfall is placed by the geometry instead of by eye. Also records the
     * flow direction there, which is the way the falling sheet must face. */
    (function findFall() {
      const P = SH.river;
      let prev = plateauSDF(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) {
        const s = plateauSDF(P[i][0], P[i][1]);
        if (prev < 0 && s >= 0) {
          const t = prev / (prev - s);
          const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t;
          const z = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t;
          SH.fallAt.x = x;
          SH.fallAt.z = z;
          SH.fallAt.ry = Math.atan2(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
          return;
        }
        prev = s;
      }
    })();

    return {
      shapes: SH, heightAt, slopeAt, buildMesh,
      plateauSDF, riverDist,
      plateauPath, rampPath, riverStroke,
      plateauH: SH.plateauH
    };
  }

  global.createTerrain = createTerrain;
})(window);
