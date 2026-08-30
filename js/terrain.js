/*
 * English Land - terrain.
 *
 * The island is a HEIGHT FIELD rather than a flat plane: one analytic function
 * `heightAt(x, z)` defines everything, and three things read from it, so they
 * can never disagree:
 *
 *   1. the terrain mesh   (a grid, sampled per vertex)
 *   2. the ground texture (the river is drawn from the same polyline, as
 *                          vectors, so its banks stay crisp)
 *   3. collision          (groundAt is literally heightAt; walls are places
 *                          where it rises faster than the player can step)
 *
 * The camp sits on flat ground. The only relief is the river channel, carved
 * into it, and the shoreline falling away to the sea at the rim.
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
      // river, carved into the flat ground
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
      shoreR: 14.3, shoreFall: 1.5, shoreDrop: 3.0
    };

    /* ------------------------------------------------------------- helpers */
    // distance to the river polyline
    function riverDist(x, z) {
      let best = 1e9;
      const P = SH.river;
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz;
        let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
        t = clamp01(t);
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < best) best = d;
      }
      return { d: best };
    }

    /* ------------------------------------------------------------ heightAt */
    function heightAt(x, z) {
      let h = 0;

      // river channel
      const rv = riverDist(x, z);
      const inRiver = smooth(SH.riverW + SH.riverBank, SH.riverW, rv.d);
      h -= inRiver * SH.riverDepth;

      // shoreline: fall away to the sea past the beach
      const rr = Math.hypot(x, z);
      const off = smooth(SH.shoreR, SH.shoreR + SH.shoreFall, rr);
      h = h * (1 - off) - SH.shoreDrop * off;

      return h;
    }

    // gradient, for classifying slopes
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

    /* ------------------------------------------ texture painting helper
     * Drawn from the same polyline the channel is carved from, so the painted
     * banks line up with the geometry. */
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

    return { shapes: SH, heightAt, slopeAt, buildMesh, riverDist, riverStroke };
  }

  global.createTerrain = createTerrain;
})(window);
