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
    size: 32,            // island is size x size
    beach: 2.8,          // sand border width
    grassH: 0.40,
    soilH: 1.60,
    soilInset: 1.1,
    edgePad: 2.3,        // stop on flat beach, before the shore starts falling
    colors: {
      sky:       '#bfe3f0',
      grass:     '#8fc861',
      grassAlt:  '#83bd57',
      grassEdge: '#78b04e',
      grassHigh: '#98d068',    // upper terrace, a touch brighter
      cliff:     '#e0b479',    // sandstone terrace face
      cliffDark: '#c9985f',
      sand:      '#f0e0ae',
      sandDark:  '#e3d199',
      path:      '#dcc189',
      pathEdge:  '#cbae76',
      dirt:      '#c9a878',
      soil:      '#8a6a4a',
      riverBed:  '#cbb98d',
      water:     '#3fa9d4',
      river:     '#48b6dd',
      shallow:   '#6fd0e8'
    }
  };

  function createWorld(scene, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    C.colors = Object.assign({}, DEFAULTS.colors, (overrides || {}).colors);
    const hex = (s) => B.Color3.FromHexString(s);
    const S = C.size, HALF = S / 2;
    const terrain = global.createTerrain({ size: S });

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

    // checker goes down FIRST, so the terrace bands paint over it, not under
    ctx.fillStyle = C.colors.grassAlt;
    const cell = 2.0;
    for (let ix = -HALF; ix < HALF; ix += cell) {
      for (let iz = -HALF; iz < HALF; iz += cell) {
        if ((Math.round(ix / cell) + Math.round(iz / cell)) % 2) continue;
        ctx.fillRect(PX(ix), PY(iz + cell), PW(cell), PW(cell));
      }
    }

    /* Terrain features are drawn from the SAME shape definitions the height
     * field uses, so the sandstone bands land exactly on the slopes. Filling
     * the grown outline and then the plain outline over it leaves a clean band,
     * without the internal arcs a stroked union would show. */
    const T = terrain;
    ctx.fillStyle = C.colors.cliffDark;
    T.plateauPath(ctx, PX, PY, PW, T.shapes.cliffBand + 0.12); ctx.fill();
    T.rampPath(ctx, PX, PY, PW, T.shapes.ramp.band + 0.20); ctx.fill();
    ctx.fillStyle = C.colors.cliff;
    T.plateauPath(ctx, PX, PY, PW, T.shapes.cliffBand * 0.5); ctx.fill();
    T.rampPath(ctx, PX, PY, PW, T.shapes.ramp.band * 0.4); ctx.fill();
    ctx.fillStyle = C.colors.grassHigh;
    T.plateauPath(ctx, PX, PY, PW, -0.18); ctx.fill();
    ctx.fillStyle = C.colors.grass;
    T.rampPath(ctx, PX, PY, PW, -0.30); ctx.fill();

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

    /* Worn dirt under the busy areas only. These were far too generous before
     * - a radius-6 patch is 113 square units, and between them they turned
     * 40% of the island brown. */
    patch(8.4, -6.0, 2.4, C.colors.dirt);     // playground
    patch(-5.2, -4.2, 1.8, C.colors.dirt);    // campfire
    patch(7.5, 6.3, 2.0, C.colors.dirt);      // farm yard
    patch(-7.0, 7.4, 1.5, C.colors.dirt);     // house frontage

    /* One circulation loop joining the five places, plus a spur up to the
     * terrace. Every route ends where something actually is - paths that
     * trail off into open grass are what made the island read as scattered. */
    const ROUTES = [
      [[-5.6, -12.6], [-5.6, -9.6], [-5.4, -6.6], [-5.2, -4.2]],   // pier -> camp
      [[-5.2, -4.2], [-3.4, -2.6], [-1.2, -1.6], [0.0, -1.1]],     // camp -> bridge
      [[0.0, -1.1], [2.6, 0.8], [4.4, 3.4], [5.0, 5.6]],           // bridge -> farm
      [[5.0, 5.6], [7.5, 6.3], [10.0, 6.3]],                       // farm cross-lane
      [[7.5, 3.0], [7.5, 6.3], [7.5, 10.4]],                       // farm spine
      [[0.6, -2.2], [3.6, -4.2], [6.6, -5.6], [9.4, -6.2]],        // bridge -> playground
      [[-5.2, -4.2], [-7.6, -6.0], [-9.8, -7.6]],                  // camp -> pool
      [[-5.4, -6.6], [-7.6, -4.4], [-9.4, -2.8]],                  // camp -> incline foot
      [[-9.4, -2.8], [-9.4, 1.8]],                                 // up the incline
      [[-9.4, 1.8], [-8.6, 4.6], [-7.4, 6.9]],                     // incline -> house
      [[-7.0, 7.0], [-4.8, 6.2], [-2.8, 4.6]]                      // house -> lookout
    ];
    // wide enough to read as a route from the normal camera pitch; too thin and
    // the island loses its legible structure and just looks scattered
    ROUTES.forEach((r) => stroke(r, 1.90, C.colors.pathEdge));
    ROUTES.forEach((r) => stroke(r, 1.50, C.colors.path));

    // the river: banks, then bed, then the water surface itself
    T.riverStroke(ctx, PX, PY, PW, (T.shapes.riverW + T.shapes.riverBank) * 2.15, C.colors.cliffDark);
    T.riverStroke(ctx, PX, PY, PW, (T.shapes.riverW + T.shapes.riverBank * 0.4) * 2, C.colors.riverBed);
    T.riverStroke(ctx, PX, PY, PW, T.shapes.riverW * 1.9, C.colors.river);

    /* AC-style grass flecks. Cheap, and they stop big open lawns reading as
     * flat colour once the camera is close. */
    ctx.fillStyle = 'rgba(120,176,78,0.55)';
    for (let i = 0; i < 2600; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * grassR;
      const gx = Math.cos(a) * rr, gz = Math.sin(a) * rr;
      const px = PX(gx), py = PY(gz), sz = PW(0.13);
      ctx.beginPath();
      ctx.moveTo(px, py - sz);
      ctx.lineTo(px + sz * 0.8, py + sz * 0.7);
      ctx.lineTo(px - sz * 0.8, py + sz * 0.7);
      ctx.closePath();
      ctx.fill();
    }
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

    // height-field grid rather than a flat plane: terraces, the incline and
    // the river channel are all geometry now, not just paint
    const top = terrain.buildMesh(scene, 'islandTop', 168);
    top.material = groundMat;
    top.receiveShadows = true;

    const soilMat = new B.StandardMaterial('soilMat', scene);
    soilMat.diffuseColor = hex(C.colors.soil);
    soilMat.specularColor = new B.Color3(0, 0, 0);

    /* The shore is part of the height field now, so there is no rim cylinder to
     * z-fight with. All that is left below is the underside of the island. */
    const SIDES = 34;
    const sh = terrain.shapes;
    const underTop = -sh.shoreDrop + 0.15;
    const soil = B.MeshBuilder.CreateCylinder('islandSoil', {
      diameterTop: (sh.shoreR + sh.shoreFall) * 2, diameterBottom: S - C.soilInset * 5,
      height: C.soilH, tessellation: SIDES
    }, scene);
    soil.position.y = underTop - C.soilH / 2;
    soil.material = soilMat;
    soil.isPickable = false;

    const tip = B.MeshBuilder.CreateCylinder('islandTip', {
      diameterTop: S - C.soilInset * 5, diameterBottom: S * 0.10,
      height: C.soilH * 2.2, tessellation: SIDES
    }, scene);
    tip.position.y = underTop - C.soilH - C.soilH * 1.1;
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

    /* --------------------------------------------------- river + waterfall
     * A ribbon following the same polyline the channel was carved from, so
     * the surface always sits inside its own banks. */
    const riverMat = new B.StandardMaterial('riverMat', scene);
    riverMat.diffuseTexture = waterTex;
    riverMat.diffuseColor = hex(C.colors.river);
    riverMat.emissiveColor = hex(C.colors.river).scale(0.22);
    riverMat.specularColor = new B.Color3(0.5, 0.55, 0.55);
    riverMat.specularPower = 96;
    riverMat.alpha = 0.9;

    const RV = terrain.shapes.river;
    const edgeA = [], edgeB = [];
    for (let i = 0; i < RV.length; i++) {
      const p = RV[i];
      const q = RV[Math.min(i + 1, RV.length - 1)];
      const o = RV[Math.max(i - 1, 0)];
      const dx = q[0] - o[0], dz = q[1] - o[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx2 = -dz / L, nz2 = dx / L;                // perpendicular
      const w = terrain.shapes.riverW * 0.98;
      // surface sits just under the local bank height
      const y = terrain.heightAt(p[0], p[1]) + terrain.shapes.riverDepth * 0.42;
      edgeA.push(new B.Vector3(p[0] + nx2 * w, y, p[1] + nz2 * w));
      edgeB.push(new B.Vector3(p[0] - nx2 * w, y, p[1] - nz2 * w));
    }
    const river = B.MeshBuilder.CreateRibbon('river',
      { pathArray: [edgeA, edgeB], sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    river.material = riverMat;
    river.isPickable = false;

    /* ---------------------------------------------------------- the camp */
    const kit = global.createPropKit(scene);
    kit.hAt = terrain.heightAt;
    /* Read the drop off the terrain rather than guessing it: sample the
     * channel bed just upstream of the lip and just downstream in the plunge
     * pool, so the sheet always spans exactly the cliff it falls over. */
    const F = terrain.shapes.fallAt;
    const fUp = terrain.heightAt(F.x - Math.sin(F.ry) * 1.0, F.z - Math.cos(F.ry) * 1.0);
    const fDn = terrain.heightAt(F.x + Math.sin(F.ry) * 1.6, F.z + Math.cos(F.ry) * 1.6);
    kit.waterfall(F.x, F.z,
      fUp + terrain.shapes.riverDepth * 0.42,
      fDn + terrain.shapes.riverDepth * 0.42, 2.7, F.ry);
    layout(kit, terrain);

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
    // Curbs you can walk over without jumping. Also the threshold that decides
    // whether terrain is a slope or a wall, so it is kept below the shallowest
    // cliff rise the player can accumulate in one frame.
    const STEP_UP = 0.16;
    /* Terrain steeper than this is a wall. The incline is ~0.56, cliff faces
     * are ~7.7, so anything between the two works. Probed a fixed distance
     * ahead, independent of how far the player actually moved this frame. */
    const MAX_SLOPE = 1.1;
    const PROBE = 0.32;
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
      // the terrain itself is the base surface now, not a flat zero
      let best = terrain.heightAt(x, z);
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
    /* fx,fz is where the player currently is; x,z is where they want to go. */
    function resolve(fx, fz, x, z, y, r, out) {
      let nx = x, nz = z;
      out.solidX = false; out.solidZ = false;

      /* Terrain acts as a wall wherever it rises faster than the player can
       * step, tested one axis at a time so you slide along a face rather than
       * sticking to it. Walkways (bridge, dock) are exempt - they sit above
       * the ground beneath them.
       *
       * The probe is a FIXED distance ahead, not the actual step. Testing the
       * step itself lets the player creep up any cliff: being blocked zeroes
       * their velocity, so the next step is nearly zero, its rise is below the
       * threshold and it is allowed - repeat sixty times a second and they
       * inch to the top. */
      if (!onWalkway(nx, nz)) {
        /* The criterion is SLOPE, not height. A fixed-height test blocks the
         * walkable incline as readily as a cliff, since both eventually get
         * high; what separates them is steepness. */
        const climbable = y + STEP_UP;
        const h0 = terrain.heightAt(fx, fz);
        const mdx = x - fx, mdz = z - fz;
        if (mdx !== 0) {
          const hx = terrain.heightAt(fx + Math.sign(mdx) * PROBE, fz);
          if (hx > climbable && (hx - h0) / PROBE > MAX_SLOPE) { nx = fx; out.solidX = true; }
        }
        if (mdz !== 0) {
          const hz = terrain.heightAt(nx, fz + Math.sign(mdz) * PROBE);
          if (hz > climbable && (hz - h0) / PROBE > MAX_SLOPE) { nz = fz; out.solidZ = true; }
        }
      }
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

        } else if (d.kind === 'fall') {
          // scroll the streaks downward; that IS the falling motion
          d.tex.vOffset -= dt2 * 1.15;
          d.tex.uOffset = Math.sin(wt * 0.6) * 0.02;

        } else if (d.kind === 'foam') {
          const f = Math.sin(wt * 4.2 + d.seed) * 0.5 + Math.sin(wt * 7.1 + d.seed) * 0.5;
          d.mesh.scaling.x = d.mesh.scaling.z = 1 + f * 0.16;
          d.mesh.scaling.y = 0.5 + f * 0.07;
          d.mesh.position.y = d.baseY + f * 0.05;

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
      terrain,
      spawn: { x: -4.6, z: -6.4 },
      groundY: 0
    };
  }

  /* ======================================================================
   * Base camp layout. Everything is placed here so the arrangement can be
   * read and changed in one place.
   * ==================================================================== */
  /* ======================================================================
   * Base camp layout.
   *
   * The island is terraced now, so every placement goes through `at()`, which
   * lifts whatever the builder produced onto the height field. Nothing here
   * needs to know its own Y.
   * ==================================================================== */
  /* ======================================================================
   * Base camp layout.
   *
   * Composed as five distinct places joined by one circulation loop, rather
   * than props sprinkled over the island. Two rules keep it readable:
   *
   *   - Decoration belongs to a place or to a path edge. Nothing is scattered
   *     at random; a field of stray mushrooms reads as clutter, not detail.
   *   - Neighbouring colliders are spaced past the sum of their half-widths
   *     plus the player's diameter, or the gap between them becomes a pocket
   *     you can stand in but never leave.
   *
   * Every placement goes through `at()`, which lifts what the builder produced
   * onto the height field, so nothing here needs to know its own Y.
   * ==================================================================== */
  function layout(k, terrain) {
    const at = (x, z, fn) => k.onGround(x, z, fn);
    const riverD = (x, z) => terrain.riverDist(x, z).d;
    const onLand = (x, z, clear) => riverD(x, z) > (clear || 2.4) &&
                                    Math.hypot(x, z) < 13.0;

    /* ======================= UPPER TERRACE (north-west) ================= */
    at(-7.0, 9.2, () => k.house(-7.0, 9.2, Math.PI));
    at(-4.9, 7.4, () => k.mailbox(-4.9, 7.4, Math.PI));
    at(-9.3, 6.6, () => k.sign(-9.3, 6.6, Math.PI * 0.86));
    // beds flanking the door, well clear of the walls
    at(-9.8, 9.8, () => k.flowerBed(-9.8, 9.8, 1.3, 1.3, ['red', 'yellow']));
    at(-4.2, 10.0, () => k.flowerBed(-4.2, 10.0, 1.3, 1.3, ['pink', 'purple']));
    at(-8.4, 12.0, () => k.hedge(-8.4, 12.0, 3.0, 0.9));
    at(-6.2, 6.4, () => k.lamp(-6.2, 6.4));
    at(-3.9, 5.6, () => k.bench(-3.9, 5.6, Math.PI * 0.75));
    at(-5.6, 4.4, () => k.birdbath(-5.6, 4.4));
    at(-11.2, 7.6, () => k.birdhouse(-11.2, 7.6, Math.PI * 0.6));
    // a railed lookout on the cliff edge above the falls
    at(-2.6, 4.4, () => k.fenceRun(-3.4, 5.2, -1.6, 3.4));
    at(-3.6, 3.0, () => k.lamp(-3.6, 3.0));

    /* ============================ CAMP (south-west) ===================== */
    const CX = -5.2, CZ = -4.2;
    at(CX, CZ, () => k.campfire(CX, CZ));
    at(CX, CZ, () => k.tripod(CX, CZ));
    // stumps on a ring, spaced so you can always walk out between them
    [[2.3, 0], [0, 2.3], [-2.3, 0], [0, -2.3]].forEach((o, i) =>
      at(CX + o[0], CZ + o[1], () => k.stump(CX + o[0], CZ + o[1], 0.95 + i * 0.03)));
    at(-2.2, -1.2, () => k.table(-2.2, -1.2));
    at(-2.2, -1.2, () => k.tableSet(-2.2, -1.2));
    at(-0.8, -0.7, () => k.chair(-0.8, -0.7, -1.2));
    at(-3.6, -0.6, () => k.chair(-3.6, -0.6, 2.2));
    at(-2.0, -2.7, () => k.chair(-2.0, -2.7, 0.1));
    at(-8.2, -2.2, () => k.bench(-8.2, -2.2, Math.PI * 0.5));
    at(-7.4, -0.6, () => k.hedge(-7.4, -0.6, 0.9, 2.6));
    at(-3.0, -6.4, () => k.lamp(-3.0, -6.4));

    /* =============================== POOL (west) ======================== */
    at(-10.6, -8.2, () => k.pool(-10.6, -8.2, 4.2, 3.0));
    at(-12.9, -6.4, () => k.poolLadder(-12.9, -6.4, 0));
    at(-7.2, -9.4, () => k.umbrella(-7.2, -9.4, 0.14));
    at(-7.6, -7.0, () => k.towel(-7.6, -7.0, 0.5, 'pink'));
    at(-6.6, -11.0, () => k.towel(-6.6, -11.0, -0.3, 'blue'));
    at(-8.8, -5.2, () => k.chair(-8.8, -5.2, -0.6));
    at(-11.4, -11.0, () => k.ball(-11.4, -11.0, 'blue'));

    /* ============================== PIER (south) ======================== */
    k.dock(-5.6, -12.9, -0.12, -0.99, 7.0);
    k.boat(-3.6, -15.6, 0.5);
    at(-7.2, -12.0, () => k.lamp(-7.2, -12.0));
    // stepping stones leading down to the sand
    at(-6.0, -9.6, () => k.stone(-6.0, -9.6, 1.0));
    at(-5.8, -10.8, () => k.stone(-5.8, -10.8, 1.0));

    /* ========================= FARM (east, north of river) ============== */
    // a proper grid; 5.0 apart leaves 1.4 of clear ground between beds
    at(5.0, 8.8, () => k.farmPlot(5.0, 8.8, 3.2, 2.4, 'carrot'));
    at(10.0, 8.8, () => k.farmPlot(10.0, 8.8, 3.2, 2.4, 'tomato'));
    at(5.0, 3.8, () => k.farmPlot(5.0, 3.8, 3.2, 2.4, 'wheat'));
    at(10.0, 3.8, () => k.farmPlot(10.0, 3.8, 3.2, 2.4, 'corn'));
    at(7.5, 11.9, () => k.farmPlot(7.5, 11.9, 4.0, 2.2, 'pumpkin'));
    at(7.5, 6.3, () => k.scarecrow(7.5, 6.3, 0.4));
    at(12.6, 6.3, () => k.wheelbarrow(12.6, 6.3, 0.9));
    at(2.6, 6.3, () => k.wateringCan(2.6, 6.3, 0.4));
    at(2.6, 10.4, () => k.bucket(2.6, 10.4, 'red'));
    at(12.4, 10.2, () => k.birdhouse(12.4, 10.2, Math.PI * 1.25));
    at(12.6, 1.6, () => k.crate(12.6, 1.6, 1.0, 0.3));

    /* ====================== PLAYGROUND (east, south of river) =========== */
    at(6.6, -3.4, () => k.sandbox(6.6, -3.4, 2.6, 2.2));
    at(11.2, -4.6, () => k.swing(11.2, -4.6, Math.PI * 0.45));
    at(6.4, -8.2, () => k.slide(6.4, -8.2, Math.PI));
    at(10.6, -8.8, () => k.seesaw(10.6, -8.8, Math.PI * 0.3));
    at(12.6, -1.8, () => k.bench(12.6, -1.8, Math.PI * 1.35));
    at(3.8, -5.6, () => k.lamp(3.8, -5.6));
    at(9.0, -1.4, () => k.ball(9.0, -1.4, 'red'));
    at(8.6, -11.4, () => k.ball(8.6, -11.4, 'yellow'));
    // crates to hop between, spaced past their collision radii
    at(3.4, -9.6, () => k.crate(3.4, -9.6, 1.0, 0.2));
    at(5.2, -11.0, () => k.crate(5.2, -11.0, 0.9, -0.3));
    at(7.2, -12.0, () => k.stump(7.2, -12.0, 1.0));

    /* ============================== CROSSINGS =========================== */
    k.bridge(0.0, -1.1, 1.265, 6.2);

    /* ================================ TREES ============================ */
    /* A perimeter band, plus a few deliberate clusters. Trees inside the camp
     * are what made the old layout read as scattered, so they now only frame
     * the places rather than sit in them. */
    const RESERVED = [
      { x: -7.0, z: 9.2, hw: 4.4, hd: 3.8 },     // house
      { x: 7.5, z: 7.5, hw: 7.6, hd: 7.4 },      // farm
      { x: 8.4, z: -6.4, hw: 6.6, hd: 6.6 },     // playground
      { x: -10.6, z: -8.2, hw: 4.4, hd: 3.6 },   // pool
      { x: -4.4, z: -3.0, hw: 4.6, hd: 4.4 },    // camp
      { x: -5.6, z: -13.0, hw: 2.6, hd: 4.4 },   // pier approach
      { x: -9.4, z: -0.5, hw: 2.6, hd: 3.6 }     // the incline
    ];
    const taken = (x, z) =>
      RESERVED.some((r) => Math.abs(x - r.x) < r.hw && Math.abs(z - r.z) < r.hd) ||
      riverD(x, z) < 2.8;

    const kinds = ['pine', 'round', 'pine', 'pine', 'round'];
    const trees = [];
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.2;
      const r = 13.1 + Math.sin(i * 2.7) * 0.55;
      trees.push([Math.cos(a) * r, Math.sin(a) * r,
                  0.95 + (i % 3) * 0.12, kinds[i % kinds.length]]);
    }
    // clusters that frame the places without cluttering them
    [[-12.2, 2.4, 1.05, 'pine'], [-11.4, 4.0, 0.95, 'round'],
     [-2.0, 11.4, 1.0, 'round'], [-0.9, 9.6, 0.9, 'pine'],
     [-11.6, 10.6, 1.05, 'pine'], [2.0, 1.6, 0.95, 'round'],
     [3.0, -1.4, 0.9, 'pine'],   [-0.6, -8.2, 1.0, 'round'],
     [-1.8, -10.4, 0.95, 'pine'],[13.0, -0.2, 1.0, 'round'],
     [1.2, 12.4, 0.95, 'pine'],  [-12.8, -3.6, 1.0, 'round']
    ].forEach((t) => trees.push(t));

    trees.forEach((t, i) => {
      if (taken(t[0], t[1]) || Math.hypot(t[0], t[1]) > 13.6) return;
      at(t[0], t[1], () => {
        if (t[3] === 'pine') k.pine(t[0], t[1], t[2], i * 0.7);
        else k.roundTree(t[0], t[1], t[2], i * 0.9, i % 2 ? 'leafA' : 'leafB',
                         i % 3 === 1 ? 'red' : (i % 5 === 2 ? 'orange' : null));
      });
    });

    /* ============================== DRESSING ===========================
     * Beds along the path edges and at the entrance to each place, rather
     * than dotted over open ground. */
    const beds = [
      [-3.6, -3.0, 'red'], [-6.6, -2.4, 'yellow'],       // camp
      [-8.4, -6.0, 'pink'], [-12.2, -9.8, 'purple'],     // pool
      [3.6, 6.3, 'yellow'], [11.6, 6.3, 'red'],          // farm lane
      [7.5, 1.8, 'pink'], [7.5, 13.4, 'orange'],
      [4.6, -2.2, 'purple'], [9.6, -10.6, 'yellow'],     // playground
      [-6.0, 7.8, 'red'], [-8.0, 5.2, 'pink'],           // terrace
      [-2.0, 6.8, 'yellow'], [-6.6, 11.0, 'purple'],
      [-4.4, -8.6, 'orange'], [1.6, -4.0, 'red']
    ];
    beds.forEach((b) => {
      if (!onLand(b[0], b[1], 2.0)) return;
      at(b[0], b[1], () => k.flowerBed(b[0], b[1], 0.8, 0.8, [b[2]]));
    });

    // small clusters of rough ground at the edges of each place
    const rough = [
      [-9.0, -3.2], [-2.6, -7.6], [-12.0, -5.2], [1.0, -6.4],
      [12.0, -6.8], [4.2, -12.6], [13.0, 3.2], [2.0, 4.0],
      [-10.4, 2.0], [-2.2, 8.6], [-12.4, 11.0], [10.0, 12.8],
      [-0.4, -11.8], [12.8, -10.4]
    ];
    rough.forEach((d, i) => {
      if (!onLand(d[0], d[1], 2.2)) return;
      at(d[0], d[1], () => {
        k.grassTuft(d[0], d[1], 1.0);
        if (i % 3 === 0) k.mushroom(d[0] + 0.7, d[1] + 0.4, 1.0, i % 2 ? 'red' : 'orange');
        if (i % 3 === 1) k.rock(d[0] - 0.6, d[1] + 0.5, 0.9, i);
      });
    });

    // boulders along the riverbank, where a real stream would leave them
    const RV = terrain.shapes.river;
    for (let i = 2; i < RV.length - 1; i++) {
      [-1, 1].forEach((side) => {
        const p = RV[i], q = RV[i + 1];
        const nx = -(q[1] - p[1]), nz = (q[0] - p[0]);
        const L = Math.hypot(nx, nz) || 1;
        const off = terrain.shapes.riverW + 0.85;
        const rx = p[0] + (nx / L) * off * side;
        const rz = p[1] + (nz / L) * off * side;
        if (Math.hypot(rx, rz) > 13.0) return;
        at(rx, rz, () => k.rock(rx, rz, 0.7 + (i % 3) * 0.2, i * 0.9));
      });
    }

    /* ========================= BUTTERFLIES + SKY ======================= */
    const flutter = [
      [-8.4, 10.2], [-4.6, 9.4], [-5.6, 5.2],            // terrace
      [5.0, 6.4], [10.0, 6.4], [7.5, 10.2],              // farm
      [-3.8, -2.6], [-6.8, -3.4],                        // camp
      [-8.4, -7.0], [6.0, -5.4], [10.4, -2.6], [1.4, -3.0]
    ];
    flutter.forEach((f, i) => at(f[0], f[1], () => k.butterfly(f[0], f[1], i)));

    /* Kept low enough to sit near the horizon. Higher up they are simply above
     * the frame at the camera's normal pitch and never seen. */
    const clouds = [
      [-46, 17, -38, 1.6], [38, 20, -54, 2.0], [-26, 15, 50, 1.7],
      [60, 18, 24, 1.4], [12, 23, 66, 2.2], [-68, 16, 30, 1.8],
      [76, 21, -20, 1.5], [-34, 19, 74, 1.9]
    ];
    clouds.forEach((c, i) => k.cloud(c[0], c[1], c[2], c[3], i));
  }

  global.createWorld = createWorld;
})(window);
