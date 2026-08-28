/*
 * English Land - scene bootstrap for the character design step.
 * Inspection stage: orbit camera, three-point-ish lighting, contact shadow,
 * idle bob, and Front/Back/Left/Right/Top view presets.
 */
(function () {
  'use strict';
  const B = window.BABYLON;

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const engine = new B.Engine(canvas, true, {
      preserveDrawingBuffer: true, stencil: true, antialias: true
    }, true);
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

    const scene = new B.Scene(engine);
    scene.clearColor = B.Color4.FromHexString('#e9e7e2ff');

    /* ------------------------------------------------------------- character */
    const char = window.createCharacter(scene);
    const H = char.height;                       // true silhouette height

    /* --------------------------------------------------------------- camera */
    // NB: the character faces +Z, so alpha = +PI/2 puts the camera in front of it.
    const camera = new B.ArcRotateCamera(
      'cam', Math.PI / 2, 1.25, H * 2.35, new B.Vector3(0, H * 0.56, 0), scene
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = H * 1.2;
    camera.upperRadiusLimit = H * 4.5;
    camera.lowerBetaLimit = 0.12;
    camera.upperBetaLimit = 1.62;
    camera.wheelDeltaPercentage = 0.02;
    camera.pinchDeltaPercentage = 0.02;
    camera.panningSensibility = 0;               // lock panning: clean turntable
    camera.useAutoRotationBehavior = true;
    camera.autoRotationBehavior.idleRotationSpeed = 0.16;
    camera.autoRotationBehavior.idleRotationWaitTime = 1400;
    camera.autoRotationBehavior.idleRotationSpinupTime = 1200;

    /* ---------------------------------------------------------------- lights */
    const hemi = new B.HemisphericLight('hemi', new B.Vector3(0.1, 1, 0.15), scene);
    hemi.intensity = 0.66;
    hemi.groundColor = B.Color3.FromHexString('#9a8f80');

    // Steep, so the contact shadow stays under the feet instead of sliding away
    // as a detached blob. The rim light carries the form that the flatter key
    // no longer models.
    const key = new B.DirectionalLight('key', new B.Vector3(-0.11, -1, -0.09), scene);
    key.position = new B.Vector3(2, 12, 2);
    key.intensity = 1.02;
    key.autoCalcShadowZBounds = true;

    const rim = new B.DirectionalLight('rim', new B.Vector3(0.72, -0.30, 0.62), scene);
    rim.intensity = 0.34;

    const fill = new B.DirectionalLight('fill', new B.Vector3(-0.55, -0.18, 0.80), scene);
    fill.intensity = 0.20;

    /* ---------------------------------------------------------------- ground */
    // large enough that its far edge never shows against the backdrop
    const ground = B.MeshBuilder.CreateGround('ground', { width: 240, height: 240 }, scene);
    const gmat = new B.StandardMaterial('gmat', scene);
    // The ground faces the key light head-on, so a backdrop-coloured albedo
    // blows out to pure white and the horizon shows as a hard seam. Pre-divide
    // the albedo by the total incident light instead; calibrated below so the
    // lit ground matches the backdrop and only the contact shadow reads.
    // = backdrop * 0.583, solved by bisection against the lit result. Re-solve
    // (EL.calibrateGround) if the lighting rig changes.
    gmat.diffuseColor = B.Color3.FromHexString('#888784');
    gmat.specularColor = new B.Color3(0, 0, 0);
    ground.material = gmat;
    ground.receiveShadows = true;

    const shadow = new B.ShadowGenerator(1024, key);
    shadow.useBlurExponentialShadowMap = true;
    shadow.blurKernel = 48;
    shadow.setDarkness(0.58);
    char.meshes.forEach((m) => shadow.addShadowCaster(m));

    /* -------------------------------------------------------- post-processing */
    try {
      const rp = new B.DefaultRenderingPipeline('rp', true, scene, [camera]);
      rp.fxaaEnabled = true;
      rp.samples = 4;
    } catch (e) { /* FXAA is a nicety, not a requirement */ }

    /* --------------------------------------------------------------- idle bob */
    const baseY = char.root.position.y;
    let t = 0;
    const idle = scene.onBeforeRenderObservable.add(() => {
      t += engine.getDeltaTime() / 1000;
      char.root.position.y      = baseY + Math.sin(t * 1.9) * 0.010;
      char.headPivot.rotation.x = Math.sin(t * 1.1) * 0.030 - 0.015;
      char.headPivot.rotation.z = Math.sin(t * 0.8) * 0.020;
      char.armL.rotation.x = Math.sin(t * 1.5) * 0.045;
      char.armR.rotation.x = Math.sin(t * 1.5 + 0.6) * 0.045;
    });

    /* ------------------------------------------------------------------- run */
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());

    scene.executeWhenReady(() => {
      const el = document.getElementById('loading');
      if (el) el.classList.add('hidden');
    });

    /* -------------------------------------------------------- view presets */
    const VIEWS = {
      front: [ Math.PI / 2, 1.30],
      back:  [-Math.PI / 2, 1.30],
      left:  [ Math.PI,     1.30],
      right: [ 0,           1.30],
      top:   [ Math.PI / 2, 0.20]
    };
    const spinBtn = document.querySelector('[data-spin]');
    const setSpin = (on) => {
      camera.useAutoRotationBehavior = on;
      spinBtn.classList.toggle('active', on);
    };
    spinBtn.addEventListener('click', () => setSpin(!camera.useAutoRotationBehavior));

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [a, b] = VIEWS[btn.dataset.view];
        setSpin(false);
        const alpha = ((a - camera.alpha + Math.PI) % (2 * Math.PI)) - Math.PI + camera.alpha;
        B.Animation.CreateAndStartAnimation('va', camera, 'alpha',  60, 26, camera.alpha,  alpha,      0);
        B.Animation.CreateAndStartAnimation('vb', camera, 'beta',   60, 26, camera.beta,   b,          0);
        B.Animation.CreateAndStartAnimation('vr', camera, 'radius', 60, 26, camera.radius, H * 2.25,   0);
      });
    });

    /* ----------------------------------------------------------------------
     * Deterministic capture hook (dev tooling).
     * Freezes the idle animation and every source of camera drift, poses the
     * camera, renders synchronously, and returns a PNG data URL.
     * -------------------------------------------------------------------- */
    window.EL = {
      scene, engine, camera, char,
      capture(alpha, beta, radiusMul, targetY, w, h) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        engine.setSize(w, h);

        camera.detachControl();
        camera.useAutoRotationBehavior = false;
        camera.inertia = 0;
        camera.inertialAlphaOffset = 0;
        camera.inertialBetaOffset = 0;
        camera.inertialRadiusOffset = 0;
        camera.inertialPanningX = 0;
        camera.inertialPanningY = 0;
        // setTarget recomputes radius to preserve position, so target goes FIRST
        camera.setTarget(new B.Vector3(0, H * targetY, 0));
        camera.alpha = alpha;
        camera.beta = beta;
        camera.radius = H * radiusMul;

        scene.render();
        scene.render();
        return {
          png: canvas.toDataURL('image/png'),
          cam: { a: camera.alpha, b: camera.beta, r: camera.radius }
        };
      },
      /* Re-solve the ground albedo so the lit ground matches the backdrop and
       * the horizon seam disappears. Run after changing the lighting rig, then
       * paste the returned hex into gmat.diffuseColor above. */
      calibrateGround() {
        const c2 = document.createElement('canvas');
        const sample = () => {
          c2.width = canvas.width; c2.height = canvas.height;
          const ctx = c2.getContext('2d');
          ctx.drawImage(canvas, 0, 0);
          return {
            g: ctx.getImageData(20, canvas.height - 20, 1, 1).data[0],
            s: ctx.getImageData(20, 20, 1, 1).data[0]
          };
        };
        const bg = B.Color3.FromHexString('#e9e7e2');
        let lo = 0.2, hi = 0.9;
        for (let i = 0; i < 14; i++) {
          const m = (lo + hi) / 2;
          gmat.diffuseColor = new B.Color3(bg.r * m, bg.g * m, bg.b * m);
          this.capture(Math.PI / 2, 1.32, 2.15, 0.52, 520, 760);
          const { g, s } = sample();
          if (g > s) hi = m; else lo = m;
        }
        return gmat.diffuseColor.toHexString();
      },
      freezeIdle() {
        scene.onBeforeRenderObservable.remove(idle);
        char.root.position.y = baseY;
        char.headPivot.rotation.set(0, 0, 0);
        char.armL.rotation.x = 0;
        char.armR.rotation.x = 0;
        scene.render();
      }
    };
  });
})();
