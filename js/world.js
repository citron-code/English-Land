/*
 * English Land - the world: a square grass platform floating over a soft sky,
 * plus the lighting rig and shadow generator.
 *
 * The platform's top surface is y = 0, so anything standing on it uses the
 * same ground plane the character was built against.
 */
(function (global) {
  'use strict';
  const B = global.BABYLON;

  const DEFAULTS = {
    size: 20,            // platform is size x size
    grassH: 0.34,        // grass slab thickness (top sits at y = 0)
    soilInset: 0.9,      // soil is narrower, so the grass overhangs it
    soilH: 1.30,
    checker: 10,         // checker squares across the platform
    colors: {
      sky:     '#cfe6ef',
      // the two greens need a real value gap - within ~10/255 the checker is
      // invisible and the platform reads as flat colour
      grass:   '#93ca6d',
      grassAlt:'#7fb257',
      soil:    '#8a6a4a',
      soilDark:'#6f5339',
      trim:    '#7ab058'
    }
  };

  function createWorld(scene, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    C.colors = Object.assign({}, DEFAULTS.colors, (overrides || {}).colors);
    const hex = (s) => B.Color3.FromHexString(s);

    scene.clearColor = B.Color4.FromColor3(hex(C.colors.sky));
    // haze toward the horizon so the platform edge doesn't cut hard against sky
    scene.fogMode = B.Scene.FOGMODE_LINEAR;
    scene.fogColor = hex(C.colors.sky);
    scene.fogStart = C.size * 1.6;
    scene.fogEnd   = C.size * 3.4;

    /* ---------------------------------------------------------------- lights */
    // Ambient has to leave headroom for the shadow to read against. At 0.70 it
    // fills the shadow back in and the cast shadow all but disappears.
    const hemi = new B.HemisphericLight('hemi', new B.Vector3(0.1, 1, 0.15), scene);
    hemi.intensity = 0.56;
    hemi.groundColor = hex('#7d8a6a');

    const key = new B.DirectionalLight('key', new B.Vector3(-0.42, -1, -0.34), scene);
    key.position = new B.Vector3(14, 26, 12);
    key.intensity = 1.02;

    const rim = new B.DirectionalLight('rim', new B.Vector3(0.72, -0.30, 0.62), scene);
    rim.intensity = 0.30;

    const fill = new B.DirectionalLight('fill', new B.Vector3(-0.55, -0.18, 0.80), scene);
    fill.intensity = 0.18;

    /* PCF rather than blur-exponential: ESM washed this shadow out completely
     * at these depth ranges, while PCF is stable and still soft-edged. */
    const shadow = new B.ShadowGenerator(2048, key);
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
    /* Darkness scales the KEY light's contribution inside the shadow; ambient
     * still lights it fully. With hemi at 0.56 a value near 0 is what actually
     * reads as a shadow - 0.36 is invisible on grass this bright. */
    shadow.setDarkness(0.06);
    shadow.bias = 0.0012;
    shadow.normalBias = 0.02;
    /* Z bounds are set by hand. autoCalcShadowZBounds fits the range to the
     * CASTERS only; the ground a shadow lands on is further along the light ray
     * than the caster's far face, so it falls outside the range and the shadow
     * is clipped away entirely. These bracket the light's distance to the
     * platform (|position| is about 32) with room on both sides. */
    key.autoCalcShadowZBounds = false;
    key.shadowMinZ = 12;
    key.shadowMaxZ = 54;

    /* ------------------------------------------------------- grass checker */
    const TEX = 512;
    const dt = new B.DynamicTexture('grassTex', { width: TEX, height: TEX }, scene, true);
    const ctx = dt.getContext();
    const cell = TEX / 2;
    ctx.fillStyle = C.colors.grass;
    ctx.fillRect(0, 0, TEX, TEX);
    ctx.fillStyle = C.colors.grassAlt;
    ctx.fillRect(0, 0, cell, cell);
    ctx.fillRect(cell, cell, cell, cell);
    dt.update();
    // DynamicTexture defaults to CLAMP (unlike Texture). Left clamped, every
    // uv past 1 samples the edge texel and the checker renders as flat colour.
    dt.wrapU = dt.wrapV = B.Texture.WRAP_ADDRESSMODE;
    dt.uScale = dt.vScale = C.checker / 2;

    const grassMat = new B.StandardMaterial('grassMat', scene);
    grassMat.diffuseTexture = dt;
    grassMat.specularColor = new B.Color3(0.02, 0.02, 0.02);

    const soilMat = new B.StandardMaterial('soilMat', scene);
    soilMat.diffuseColor = hex(C.colors.soil);
    soilMat.specularColor = new B.Color3(0, 0, 0);

    const trimMat = new B.StandardMaterial('trimMat', scene);
    trimMat.diffuseColor = hex(C.colors.trim);
    trimMat.specularColor = new B.Color3(0, 0, 0);

    /* -------------------------------------------------------------- meshes */
    // grass slab: top face at exactly y = 0
    const grass = B.MeshBuilder.CreateBox('grass', {
      width: C.size, height: C.grassH, depth: C.size
    }, scene);
    grass.position.y = -C.grassH / 2;
    grass.material = grassMat;
    grass.receiveShadows = true;

    // soil block below, inset so the grass reads as an overhanging lip
    const soilSize = C.size - C.soilInset * 2;
    const soil = B.MeshBuilder.CreateBox('soil', {
      width: soilSize, height: C.soilH, depth: soilSize
    }, scene);
    soil.position.y = -C.grassH - C.soilH / 2 + 0.02;
    soil.material = soilMat;
    soil.receiveShadows = true;

    // tapered underside, so the island comes to a soft point rather than a slab
    const tip = B.MeshBuilder.CreateCylinder('soilTip', {
      diameterTop: soilSize * 0.80, diameterBottom: soilSize * 0.10,
      height: C.soilH * 1.5, tessellation: 4
    }, scene);
    tip.rotation.y = Math.PI / 4;
    tip.position.y = -C.grassH - C.soilH - C.soilH * 0.72 + 0.04;
    tip.material = soilMat;

    const half = C.size / 2;
    return {
      cfg: C, shadow, grass, soil,
      lights: { hemi, key, rim, fill },
      // playable extent; the controller keeps the character inside this
      bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
      groundY: 0
    };
  }

  global.createWorld = createWorld;
})(window);
