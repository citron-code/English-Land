/*
 * English Land - the base camp island.
 *
 * The island top is a single ground mesh with ONE painted 1:1 texture (grass,
 * checker, sand beach, dirt patches and every path). Painting the paths costs
 * no geometry and no draw calls, and it means the layout can be changed
 * without touching any meshes.
 *
 * Props come from props.js. They are static, so once placed they are merged by
 * material into a handful of meshes; only water and fire stay separate.
 *
 * Collision is exposed as two queries used by player.js:
 *   groundAt(x, z, y)     height of the surface under a point
 *   resolve(x, z, y, r)   push a circle out of anything solid
 */
(function (global) {
  'use strict';
  const B = global.BABYLON;

  const DEFAULTS = {
    size: 28,            // island is size x size
    beach: 2.6,          // sand border width
    grassH: 0.40,
    soilH: 1.60,
    soilInset: 1.1,
    edgePad: 1.5,        // playable area stops this far inside the rim
    colors: {
      sky:       '#bfe3f0',
      grass:     '#8fc861',
      grassAlt:  '#83bd57',
      grassEdge: '#78b04e',
      sand:      '#f0e0ae',
      sandDark:  '#e3d199',
      path:      '#dcc189',
      pathEdge:  '#cbae76',
      dirt:      '#c9a878',
      soil:      '#8a6a4a',
      water:     '#3fa9d4',
      shallow:   '#6fd0e8'
    }
  };

  function createWorld(scene, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    C.colors = Object.assign({}, DEFAULTS.colors, (overrides || {}).colors);
    const hex = (s) => B.Color3.FromHexString(s);
    const S = C.size, HALF = S / 2;

    scene.clearColor = B.Color4.FromColor3(hex(C.colors.sky));
    scene.fogMode = B.Scene.FOGMODE_LINEAR;
    scene.fogColor = hex(C.colors.sky);
    scene.fogStart = 42;
    scene.fogEnd = 130;

    /* Sky dome: a vertical gradient painted onto the inside of a big sphere.
     * A flat clearColor gives a dead, posterised backdrop. Fog is disabled on
     * it or the fog colour washes the gradient straight back out. */
    const skyTex = new B.DynamicTexture('skyTex', { width: 8, height: 256 }, scene, true);
    const skc = skyTex.getContext();
    const sky = skc.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0.00, '#7fc4e8');     // zenith
    sky.addColorStop(0.55, '#bfe3f0');
    sky.addColorStop(1.00, '#e6f4f7');     // horizon haze
    skc.fillStyle = sky;
    skc.fillRect(0, 0, 8, 256);
    skyTex.update();

    const skyMat = new B.StandardMaterial('skyMat', scene);
    skyMat.emissiveTexture = skyTex;
    skyMat.diffuseColor = new B.Color3(0, 0, 0);
    skyMat.specularColor = new B.Color3(0, 0, 0);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;

    const skyDome = B.MeshBuilder.CreateSphere('skyDome',
      { diameter: 320, segments: 16, sideOrientation: B.Mesh.BACKSIDE }, scene);
    skyDome.material = skyMat;
    skyDome.applyFog = false;
    skyDome.isPickable = false;
    skyDome.infiniteDistance = false;

    /* ---------------------------------------------------------------- lights */
    // Ambient has to leave headroom for the shadow to read against; too high
    // and the cast shadow fills back in and disappears.
    const hemi = new B.HemisphericLight('hemi', new B.Vector3(0.1, 1, 0.15), scene);
    hemi.intensity = 0.62;
    hemi.groundColor = hex('#7d8a6a');

    const key = new B.DirectionalLight('key', new B.Vector3(-0.42, -1, -0.34), scene);
    key.position = new B.Vector3(24, 40, 20);
    key.intensity = 1.00;

    const rim = new B.DirectionalLight('rim', new B.Vector3(0.72, -0.30, 0.62), scene);
    rim.intensity = 0.26;

    const shadow = new B.ShadowGenerator(2048, key);
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
    shadow.setDarkness(0.10);
    shadow.bias = 0.0016;
    shadow.normalBias = 0.03;
    /* autoCalcShadowZBounds fits the range to the CASTERS only, so the ground a
     * shadow lands on falls outside it and the shadow is clipped away. Set by
     * hand to bracket the light's distance to the island. */
    key.autoCalcShadowZBounds = false;
    key.shadowMinZ = 20;
    key.shadowMaxZ = 95;

    /* ------------------------------------------------------- ground texture */
    const TEX = 2048;
    const dt = new B.DynamicTexture('islandTex', { width: TEX, height: TEX }, scene, true);
    const ctx = dt.getContext();
    // world -> canvas. Canvas y runs downward and DynamicTexture inverts Y, so
    // +z maps to the top of the image.
    const PX = (x) => (x + HALF) / S * TEX;
    const PY = (z) => (HALF - z) / S * TEX;
    const PW = (w) => w / S * TEX;

    ctx.fillStyle = C.colors.sand;
    ctx.fillRect(0, 0, TEX, TEX);

    // scatter a little tonal variation into the sand
    ctx.fillStyle = C.colors.sandDark;
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r = HALF - 0.3 - Math.random() * (C.beach - 0.4);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      ctx.beginPath();
      ctx.arc(PX(cx), PY(cz), PW(0.10 + Math.random() * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }

    /* The island is a disc, so the grass is a circle and the sand is the ring
     * left around it. A rounded square would push its corners past the disc
     * edge and leave no beach on the diagonals. */
    const circle = (cx, cz, rad) => {
      ctx.beginPath();
      ctx.arc(PX(cx), PY(cz), PW(rad), 0, Math.PI * 2);
      ctx.closePath();
    };

    const grassR = HALF - C.beach;
    ctx.fillStyle = C.colors.grassEdge;
    circle(0, 0, grassR + 0.26); ctx.fill();
    ctx.fillStyle = C.colors.grass;
    circle(0, 0, grassR); ctx.fill();

    // checker, clipped to the grass so it never bleeds onto the sand
    ctx.save();
    circle(0, 0, grassR); ctx.clip();
    ctx.fillStyle = C.colors.grassAlt;
    const cell = 2.0;
    for (let ix = -HALF; ix < HALF; ix += cell) {
      for (let iz = -HALF; iz < HALF; iz += cell) {
        if ((Math.round(ix / cell) + Math.round(iz / cell)) % 2) continue;
        ctx.fillRect(PX(ix), PY(iz + cell), PW(cell), PW(cell));
      }
    }

    /* ------------------------------------------------------------- paths */
    const stroke = (pts, w, colour) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = PW(w);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const px = PX(p[0]), py = PY(p[1]);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.stroke();
    };
    const patch = (x, z, r, colour) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(PX(x), PY(z), PW(r), 0, Math.PI * 2);
      ctx.fill();
    };

    // worn dirt under the busy areas
    patch(7.6, 6.2, 4.2, C.colors.dirt);      // playground
    patch(-2.6, -5.4, 2.2, C.colors.dirt);    // campfire
    patch(-8.0, -1.2, 3.4, C.colors.dirt);    // garden

    const ROUTES = [
      [[0, -11.4], [0, -7.0], [0.4, -2.0], [0, 3.0], [-0.4, 7.0], [0, 9.6]],  // spine
      [[0, 6.6], [-2.6, 7.4], [-5.4, 7.2]],                                    // house
      [[0.2, 4.6], [3.4, 5.2], [6.6, 5.6]],                                    // playground
      [[0.3, -2.6], [3.6, -3.4], [6.8, -4.2]],                                 // pool
      [[-0.1, -0.8], [-3.4, -1.0], [-6.6, -1.2]],                              // garden
      [[0, -6.2], [-2.4, -5.6]],                                               // campfire spur
      [[0.4, 1.4], [2.6, 1.6]]                                                 // table spur
    ];
    ROUTES.forEach((r) => stroke(r, 1.85, C.colors.pathEdge));
    ROUTES.forEach((r) => stroke(r, 1.45, C.colors.path));
    ctx.restore();

    // wet sand + foam where the water meets the shore
    ctx.strokeStyle = 'rgba(214,196,150,0.85)';
    ctx.lineWidth = PW(0.95);
    circle(0, 0, HALF - 0.75); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth = PW(0.42);
    circle(0, 0, HALF - 0.30); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = PW(0.22);
    circle(0, 0, HALF - 0.62); ctx.stroke();

    /* Punch the island out as a disc. Everything outside becomes transparent
     * and the ground material alpha-TESTS it away, which is what gives the
     * island a round silhouette without any custom geometry. */
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#fff';
    circle(0, 0, HALF - 0.06); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    dt.update();
    dt.hasAlpha = true;                                  // cutout, not blend
    dt.wrapU = dt.wrapV = B.Texture.CLAMP_ADDRESSMODE;   // 1:1, no tiling

    /* ------------------------------------------------------ island meshes */
    const groundMat = new B.StandardMaterial('groundMat', scene);
    groundMat.diffuseTexture = dt;
    groundMat.specularColor = new B.Color3(0.02, 0.02, 0.02);

    const top = B.MeshBuilder.CreateGround('islandTop',
      { width: S, height: S, subdivisions: 1 }, scene);
    top.material = groundMat;
    top.receiveShadows = true;
    top.isPickable = false;

    const soilMat = new B.StandardMaterial('soilMat', scene);
    soilMat.diffuseColor = hex(C.colors.soil);
    soilMat.specularColor = new B.Color3(0, 0, 0);

    // Body matches the painted disc. Its top face must sit BELOW the ground
    // plane; coplanar at y=0 they z-fight and the brown rim wins, hiding the
    // painted ground entirely.
    const SIDES = 30;
    const rimBlock = B.MeshBuilder.CreateCylinder('islandRim', {
      diameter: S - 0.12, height: C.grassH, tessellation: SIDES
    }, scene);
    rimBlock.position.y = -C.grassH / 2 - 0.025;
    rimBlock.material = soilMat;
    rimBlock.isPickable = false;

    const soil = B.MeshBuilder.CreateCylinder('islandSoil', {
      diameterTop: S - 0.6, diameterBottom: S - C.soilInset * 4,
      height: C.soilH, tessellation: SIDES
    }, scene);
    soil.position.y = -C.grassH - C.soilH / 2 + 0.02;
    soil.material = soilMat;
    soil.isPickable = false;

    const tip = B.MeshBuilder.CreateCylinder('islandTip', {
      diameterTop: S - C.soilInset * 4, diameterBottom: S * 0.10,
      height: C.soilH * 2.1, tessellation: SIDES
    }, scene);
    tip.position.y = -C.grassH - C.soilH - C.soilH * 1.0;
    tip.material = soilMat;
    tip.isPickable = false;

    /* -------------------------------------------------------------- water */
    const waterTex = new B.DynamicTexture('waterTex', { width: 512, height: 512 }, scene, true);
    const wc = waterTex.getContext();
    wc.fillStyle = C.colors.water;
    wc.fillRect(0, 0, 512, 512);
    wc.strokeStyle = 'rgba(255,255,255,0.20)';
    wc.lineWidth = 7;
    for (let i = 0; i < 14; i++) {
      const y = i * 38 + 10;
      wc.beginPath();
      for (let x = 0; x <= 512; x += 16) {
        const yy = y + Math.sin((x / 512) * Math.PI * 4 + i) * 7;
        if (x) wc.lineTo(x, yy); else wc.moveTo(x, yy);
      }
      wc.stroke();
    }
    waterTex.update();
    waterTex.wrapU = waterTex.wrapV = B.Texture.WRAP_ADDRESSMODE;
    waterTex.uScale = waterTex.vScale = 14;

    const waterMat = new B.StandardMaterial('waterMat', scene);
    waterMat.diffuseTexture = waterTex;
    waterMat.diffuseColor = hex(C.colors.water);
    waterMat.specularColor = new B.Color3(0.55, 0.6, 0.6);
    waterMat.specularPower = 96;
    waterMat.alpha = 0.92;

    const water = B.MeshBuilder.CreateGround('water', { width: 300, height: 300 }, scene);
    water.position.y = -0.62;
    water.material = waterMat;
    water.isPickable = false;

    /* Shallow shelf hugging the island. Painted as a radial ramp so it fades
     * into open water - a flat plane leaves a hard rectangle on the surface. */
    const shTex = new B.DynamicTexture('shallowTex', { width: 256, height: 256 }, scene, true);
    const sc = shTex.getContext();
    const g = sc.createRadialGradient(128, 128, 40, 128, 128, 128);
    g.addColorStop(0.00, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1.00, 'rgba(255,255,255,0.0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, 256, 256);
    shTex.update();
    shTex.hasAlpha = true;

    const shallowMat = new B.StandardMaterial('shallowMat', scene);
    shallowMat.diffuseColor = hex(C.colors.shallow);
    shallowMat.emissiveColor = hex(C.colors.shallow).scale(0.35);
    shallowMat.opacityTexture = shTex;
    shallowMat.specularColor = new B.Color3(0.2, 0.2, 0.2);

    const shallow = B.MeshBuilder.CreateGround('shallow',
      { width: S + 16, height: S + 16 }, scene);
    shallow.position.y = -0.48;
    shallow.material = shallowMat;
    shallow.isPickable = false;

    /* ---------------------------------------------------------- the camp */
    const kit = global.createPropKit(scene);
    layout(kit);

    /* Merge the static props by material. A few hundred small meshes is a few
     * hundred draw calls; this collapses them to one per material. */
    const byMat = new Map();
    kit.meshes.forEach((m) => {
      const k = m.material.name;
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(m);
    });
    const merged = [];
    byMat.forEach((list, k) => {
      const m = list.length === 1
        ? list[0]
        : B.Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!m) return;
      m.name = 'camp_' + k;
      m.isPickable = false;
      m.receiveShadows = true;
      m.convertToFlatShadedMesh();
      m.freezeWorldMatrix();
      merged.push(m);
      shadow.addShadowCaster(m);
    });

    /* ------------------------------------------------------ collision API */
    const solids = kit.solids;
    const platforms = kit.platforms;
    const STEP_UP = 0.20;      // curbs you can walk over without jumping
    /* You can stand with your feet slightly over an edge. This margin must
     * EXCEED the inflation used for side-blocking below, or there is a dead
     * band where you have cleared the block but cannot land yet, and jumping
     * onto small props becomes impossible. */
    const STAND_MARGIN = 0.30;
    const PLAT_BLOCK = 0.78;   // fraction of the player radius platforms block by
    const walkways = kit.walkways || [];
    const onWalkway = (x, z) => {
      for (let i = 0; i < walkways.length; i++) {
        const w = walkways[i];
        if (Math.abs(x - w.x) < w.hw && Math.abs(z - w.z) < w.hd) return true;
      }
      return false;
    };
    // the island is a disc, so the shoreline is a radius, not a box
    const limR = HALF - C.edgePad;

    function groundAt(x, z, y) {
      let best = 0;
      const m = STAND_MARGIN;
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (x < p.x - p.hw - m || x > p.x + p.hw + m) continue;
        if (z < p.z - p.hd - m || z > p.z + p.hd + m) continue;
        // only surfaces at or below the feet (plus a small step) count
        if (p.top <= y + STEP_UP && p.top > best) best = p.top;
      }
      return best;
    }

    /* out gets {x, z, solidX, solidZ}. The solid flags matter: the caller kills
     * velocity only against things that are permanently solid. A platform that
     * is merely still above you is a transient block - killing velocity there
     * scrubs off all your forward speed against the face while you rise, and
     * you can never jump onto anything. */
    function resolve(x, z, y, r, out) {
      let nx = x, nz = z;
      out.solidX = false; out.solidZ = false;
      /* Two passes. Colliders are resolved one at a time, so when two overlap
       * the second push can undo the first and leave the player inside the
       * one already handled. A second pass settles that. */
      for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.kind === 'circle') {
          const dx = nx - s.x, dz = nz - s.z;
          const d = Math.hypot(dx, dz), min = s.r + r;
          if (d < min && d > 1e-5) {
            nx = s.x + dx / d * min; nz = s.z + dz / d * min;
            out.solidX = out.solidZ = true;
          } else if (d <= 1e-5) { nx = s.x + min; out.solidX = true; }
        } else {
          const dx = nx - s.x, dz = nz - s.z;
          const ox = s.hw + r - Math.abs(dx);
          const oz = s.hd + r - Math.abs(dz);
          if (ox > 0 && oz > 0) {
            // push out along whichever axis needs the least correction
            if (ox < oz) { nx = s.x + Math.sign(dx || 1) * (s.hw + r); out.solidX = true; }
            else { nz = s.z + Math.sign(dz || 1) * (s.hd + r); out.solidZ = true; }
          }
        }
      }
      // platforms only block while you are below their top surface
      const pr = r * PLAT_BLOCK;
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (y >= p.top - 0.06) continue;
        const dx = nx - p.x, dz = nz - p.z;
        const ox = p.hw + pr - Math.abs(dx);
        const oz = p.hd + pr - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) nx = p.x + Math.sign(dx || 1) * (p.hw + pr);
          else nz = p.z + Math.sign(dz || 1) * (p.hd + pr);
        }
      }
      }
      // Shoreline, as a radius - unless the point is on a walkway (the dock),
      // which deliberately reaches out past the beach.
      const d = Math.hypot(nx, nz);
      if (d > limR && !onWalkway(nx, nz)) {
        nx = nx / d * limR; nz = nz / d * limR;
        out.solidX = out.solidZ = true;
      }
      out.x = nx; out.z = nz;
      return out;
    }

    /* ---------------------------------------------------------- animation */
    let wt = 0;
    function update(dt2) {
      wt += dt2;
      waterTex.uOffset = wt * 0.012;
      waterTex.vOffset = Math.sin(wt * 0.16) * 0.014;
      water.position.y = -0.62 + Math.sin(wt * 0.7) * 0.022;
      for (let i = 0; i < kit.dynamic.length; i++) {
        const d = kit.dynamic[i];
        if (d.kind === 'flame') {
          const f = Math.sin(wt * 9 + d.seed) * 0.5 + Math.sin(wt * 14.7 + d.seed) * 0.5;
          d.mesh.scaling.y = 1 + f * 0.16;
          d.mesh.scaling.x = d.mesh.scaling.z = 1 - f * 0.09;
          d.mesh.position.y = d.baseY + f * 0.035;
          d.mesh.rotation.y = wt * 1.6 + d.seed;
        } else if (d.kind === 'pool') {
          d.mesh.position.y = d.baseY + Math.sin(wt * 1.6) * 0.012;

        } else if (d.kind === 'butterfly') {
          /* Wander on a sum of sines - two frequencies per axis so the path
           * never repeats obviously. Heading comes from sampling the same
           * curve a moment ahead, so the butterfly always faces its travel. */
          const t = wt * d.sp + d.seed;
          const at = (u) => ({
            x: d.home.x + Math.sin(u) * d.r1 + Math.sin(u * 2.3 + 1.1) * d.r2,
            z: d.home.z + Math.cos(u * 1.19) * d.r1 + Math.cos(u * 2.7) * d.r2,
            y: d.hi + Math.sin(u * 3.1) * 0.28 + Math.sin(u * 5.3) * 0.10
          });
          const p0 = at(t), p1 = at(t + 0.05);
          d.node.position.set(p0.x, p0.y, p0.z);
          d.node.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z);
          d.node.rotation.x = -(p1.y - p0.y) * 1.6;
          // wings beat fast and independently of the drift speed
          const flap = Math.sin(wt * 17 + d.seed * 3) * 0.85 + 0.30;
          d.wings[0].hinge.rotation.z = flap;
          d.wings[1].hinge.rotation.z = -flap;

        } else if (d.kind === 'cloud') {
          d.node.position.x += d.sp * dt2;
          if (d.node.position.x > 150) d.node.position.x = -150;
          d.node.position.y += Math.sin(wt * 0.3 + d.sp) * 0.004;
        }
      }
    }

    return {
      cfg: C, shadow, lights: { hemi, key, rim },
      top, water, merged, kit,
      solids, platforms,
      groundAt, resolve, update,
      bounds: { minX: -limR, maxX: limR, minZ: -limR, maxZ: limR, radius: limR },
      spawn: { x: 0, z: -6.5 },
      groundY: 0
    };
  }

  /* ======================================================================
   * Base camp layout. Everything is placed here so the arrangement can be
   * read and changed in one place.
   * ==================================================================== */
  function layout(k) {
    /* ------------------------------------------------------------- house */
    k.house(-5.6, 9.2, Math.PI);          // front faces -Z, toward the player
    k.mailbox(-2.9, 7.9, Math.PI);
    k.sign(-8.9, 6.6, Math.PI * 0.85);
    k.bush(-8.2, 9.4, 1.1);
    k.bush(-2.6, 10.2, 0.9);
    k.flowerBed(-8.4, 8.4, 1.2, 1.2, ['red', 'yellow']);
    k.lamp(-2.4, 6.2);

    /* ------------------------------------------------------------ garden */
    k.planter(-8.6, 0.6, 3.0, 1.3, ['red', 'pink', 'yellow']);
    k.planter(-8.6, -3.0, 3.0, 1.3, ['purple', 'yellow', 'red']);
    k.flowerBed(-6.0, -1.2, 1.4, 2.4, ['pink', 'purple', 'yellow', 'red']);
    k.birdbath(-4.6, 1.9);
    k.fenceRun(-10.6, 2.2, -4.4, 2.2);
    k.fenceRun(-10.6, -4.8, -10.6, 2.2);
    k.fenceRun(-10.6, -4.8, -4.4, -4.8);
    k.bench(-4.9, -2.9, Math.PI * 0.5);
    k.bush(-10.0, 1.2, 0.9);
    k.bush(-9.4, -4.2, 0.8);

    /* -------------------------------------------------------- playground */
    k.sandbox(6.4, 8.2, 2.6, 2.2);
    k.swing(9.9, 6.4, Math.PI * 0.5);
    k.slide(6.2, 4.2, 0);
    k.ball(8.4, 8.6, 'red');
    k.ball(4.8, 7.0, 'blue');
    k.bench(8.6, 9.6, Math.PI);
    k.lamp(4.4, 6.0);
    /* Crates to hop between. Spaced past the sum of their blocking radii
     * (half-width + player radius); any closer and the overlapping colliders
     * fight each other and squeeze the player through. */
    k.crate(3.0, 8.6, 1.0, 0.2);
    k.crate(4.7, 9.2, 0.9, -0.3);
    k.crate(1.6, 9.9, 1.05, 0.5);

    /* -------------------------------------------------------------- pool */
    k.pool(8.4, -5.4, 4.4, 3.2);
    k.chair(5.0, -3.4, -0.6);
    k.ball(6.0, -7.6, 'yellow');
    k.bush(11.4, -3.0, 1.0);
    k.lamp(5.2, -3.0);

    /* ------------------------------------------------- centre of the camp */
    k.table(2.9, 1.5);
    k.chair(4.2, 1.9, -1.1);
    k.chair(1.7, 2.2, 2.2);
    k.chair(3.1, 0.2, 0.1);
    k.campfire(-2.6, -5.4);
    k.stump(-1.4, -6.4, 1.0);
    k.stump(-3.9, -6.3, 0.95);
    k.stump(-3.6, -4.1, 0.9);

    /* stepping stones and stumps: low hops off the path */
    k.stone(2.0, -6.6, 1.0);
    k.stone(3.3, -7.5, 1.0);
    k.stone(4.6, -8.4, 1.0);
    k.stump(6.0, -9.2, 1.0);
    k.crate(-6.3, 4.3, 1.0, 0.3);
    k.crate(-7.9, 5.4, 0.85, -0.2);
    k.stump(1.9, 4.3, 1.0);
    k.crate(-0.9, 10.4, 1.0, 0.4);
    k.crate(0.8, 11.0, 0.9, -0.4);

    /* Trees ring the shoreline. Placed on a CIRCLE, since the island is a
     * disc - laid out on a square they float off the edge at the diagonals. */
    /* Zones already occupied by a built area. A tree dropped on the ring can
     * otherwise land inside the pool or the playground. */
    const RESERVED = [
      { x: -5.6, z: 9.2, hw: 4.0, hd: 3.4 },    // house
      { x: 8.4, z: -5.4, hw: 4.0, hd: 3.4 },    // pool
      { x: 7.2, z: 6.6, hw: 4.8, hd: 4.4 },     // playground
      { x: -8.0, z: -1.2, hw: 4.0, hd: 4.6 },   // garden
      { x: 0, z: 0, hw: 1.6, hd: 13 },          // the main path spine
      { x: 2.9, z: 1.5, hw: 2.4, hd: 2.2 }      // table
    ];
    const taken = (x, z) => RESERVED.some(
      (r) => Math.abs(x - r.x) < r.hw && Math.abs(z - r.z) < r.hd);

    const RING_R = 11.7;
    const kinds = ['pine', 'pine', 'round', 'pine', 'round'];
    const ring = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.15;
      const r = RING_R + Math.sin(i * 2.3) * 0.55;
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r;
      if (taken(tx, tz)) continue;
      ring.push([tx, tz, 0.95 + (i % 3) * 0.11, kinds[i % kinds.length]]);
    }
    // a few inside the camp for depth
    ring.push([7.2, 1.6, 0.95, 'round'], [-0.8, 8.4, 0.9, 'round'],
              [9.4, -1.8, 1.0, 'pine'],  [-6.2, -7.6, 1.05, 'round'],
              [2.6, -9.2, 0.9, 'pine']);
    ring.forEach((t, i) => {
      if (t[3] === 'pine') k.pine(t[0], t[1], t[2], i * 0.7);
      else k.roundTree(t[0], t[1], t[2], i * 0.9, i % 2 ? 'leafA' : 'leafB',
                       i % 4 === 1 ? 'red' : (i % 7 === 3 ? 'orange' : null));
    });

    /* scattered flowers to lift the colour, kept off the paths */
    const spots = [
      [-3.8, 4.6], [-2.2, 3.4], [3.8, 3.4], [5.2, 2.4], [-5.4, 6.0],
      [7.8, 3.0], [-9.6, 4.4], [10.0, 1.2], [-1.6, -8.6], [1.2, -9.4],
      [-7.2, -6.4], [6.8, -1.4], [-9.2, -6.0], [3.2, 10.2], [-4.6, 10.4],
      [9.8, -6.4], [-8.2, 8.0], [7.4, 9.4]
    ];
    const cols = ['red', 'yellow', 'pink', 'purple', 'orange'];
    spots.forEach((s, i) => k.flowerBed(s[0], s[1], 0.7, 0.7, [cols[i % cols.length]]));

    /* ------------------------------------------------------------ detail */
    k.birdhouse(-3.9, 11.0, Math.PI * 0.9);
    k.birdhouse(10.2, 3.4, Math.PI * 1.4);
    k.hedge(-3.2, 9.6, 2.6, 0.9);
    k.hedge(4.0, 2.6, 0.9, 2.4);
    k.seesaw(9.0, 9.0, Math.PI * 0.35);
    k.poolLadder(6.6, -3.9, 0);
    k.umbrella(4.6, -6.8, 0.14);
    k.towel(5.8, -8.3, 0.4, 'pink');
    k.towel(3.6, -5.6, -0.3, 'blue');
    k.tripod(-2.6, -5.4);
    k.wheelbarrow(-6.4, 1.2, 0.7);
    k.wateringCan(-5.2, -0.2, 0.4);
    k.tableSet(2.9, 1.5);
    k.bucket(6.2, 8.0, 'yellow');
    k.bucket(-9.5, -1.9, 'red');

    // pier out over the water, with a boat moored alongside
    const dock = k.dock(0.4, -12.1, 0.0, -1.0, 7.0);
    k.boat(2.2, -15.6, 0.35);
    k.lamp(-1.1, -12.4);

    // mushrooms, rocks and grass tufts to break up open grass
    const detail = [
      [-9.8, 6.2], [-6.8, 10.2], [4.2, -10.4], [-2.0, 10.6], [10.6, -2.4],
      [-11.0, -2.4], [8.0, 2.2], [-4.0, -9.4], [6.2, -0.4], [-8.6, 4.0],
      [2.2, 6.4], [-3.0, 0.6], [5.0, 4.2], [-10.4, 8.2], [9.2, -8.6]
    ];
    detail.forEach((d, i) => {
      if (i % 3 === 0) k.mushroom(d[0], d[1], 0.9 + (i % 3) * 0.2, i % 2 ? 'red' : 'orange');
      else if (i % 3 === 1) k.rock(d[0], d[1], 0.8 + (i % 4) * 0.22, i);
      else k.grassTuft(d[0], d[1], 1.0);
    });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.9;
      const r = 5.5 + (i % 5) * 1.3;
      const gx = Math.cos(a) * r, gz = Math.sin(a) * r;
      if (Math.abs(gx) < 1.4) continue;              // keep the main path clear
      k.grassTuft(gx, gz, 0.85 + (i % 3) * 0.2);
    }

    /* ------------------------------------------------- butterflies + sky */
    /* Homes are kept clear of the house and other tall props - the wander
     * radius is up to ~3 units and butterflies will fly into a wall. */
    const flutter = [
      [-8.4, 0.4], [-6.0, -1.2], [-3.8, 4.6], [3.8, 3.4], [5.2, 2.4],
      [7.8, 3.0], [-5.4, 5.4], [1.2, -9.4], [-1.0, 6.4], [6.8, -1.4],
      [10.0, 1.2], [-1.6, -8.6]
    ];
    flutter.forEach((f, i) => k.butterfly(f[0], f[1], i));

    /* Kept low enough to sit near the horizon. Higher up they are simply above
     * the frame at the camera's normal pitch and never seen. */
    const clouds = [
      [-42, 17, -34, 1.6], [34, 20, -50, 2.0], [-22, 15, 46, 1.7],
      [56, 18, 20, 1.4], [10, 23, 62, 2.2], [-64, 16, 26, 1.8],
      [72, 21, -18, 1.5], [-30, 19, 70, 1.9]
    ];
    clouds.forEach((c, i) => k.cloud(c[0], c[1], c[2], c[3], i));
  }

  global.createWorld = createWorld;
})(window);
