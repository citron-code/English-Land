/*
 * English Land - bootstrap. Wires world + character + player controller and
 * runs the loop.
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

    const world = window.createWorld(scene);
    const char  = window.createCharacter(scene);
    const H = char.height;

    /* --------------------------------------------------------------- camera */
    // Behind the character and slightly above: alpha -PI/2 puts the camera on
    // -Z looking toward +Z, the direction the character faces.
    const camera = new B.ArcRotateCamera(
      'cam', -Math.PI / 2, 1.12, H * 4.2,
      new B.Vector3(0, H * 0.62, 0), scene
    );
    camera.attachControl(canvas, true);
    // Default minZ 1.0 clips the model on close shots and looks like mesh holes
    camera.minZ = 0.05;
    camera.maxZ = 400;
    camera.lowerRadiusLimit = H * 1.8;
    camera.upperRadiusLimit = H * 9;
    camera.lowerBetaLimit = 0.35;
    camera.upperBetaLimit = 1.48;          // stop the camera dropping under the platform
    camera.wheelDeltaPercentage = 0.02;
    camera.pinchDeltaPercentage = 0.02;
    camera.panningSensibility = 0;         // no panning: the player is the subject

    world.shadow.getShadowMap().renderList.push(...char.meshes);
    world.top.receiveShadows = true;

    /* -------------------------------------------------------- post-processing */
    try {
      const rp = new B.DefaultRenderingPipeline('rp', true, scene, [camera]);
      rp.fxaaEnabled = true;
      rp.samples = 4;
    } catch (e) { /* FXAA is a nicety, not a requirement */ }

    /* --------------------------------------------------------------- player */
    const player = window.createPlayer(scene, char, camera, world);

    const speedEl = document.getElementById('speed');
    let hudT = 0;

    player.teleport(world.spawn.x, world.spawn.z);

    // capture() calls scene.render(), which fires this observer, which re-aims
    // the camera at the player - overriding whatever the capture asked for.
    let capturing = false;

    scene.onBeforeRenderObservable.add(() => {
      if (capturing) return;
      const dt = engine.getDeltaTime() / 1000;
      world.update(dt);
      const speed = player.update(dt);

      hudT += dt;
      if (speedEl && hudT > 0.1) {
        hudT = 0;
        speedEl.textContent = player.airborne
          ? 'in the air'
          : (speed < 0.05 ? 'idle'
            : (speed > player.cfg.walkSpeed + 0.3 ? 'running' : 'walking'));
      }
    });

    /* ------------------------------------------------------------------- run */
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());

    scene.executeWhenReady(() => {
      const el = document.getElementById('loading');
      if (el) el.classList.add('hidden');
      canvas.focus();
    });

    /* ----------------------------------------------------------------------
     * Dev capture hook - deterministic screenshots for verification.
     * -------------------------------------------------------------------- */
    window.EL = {
      scene, engine, camera, char, world, player,
      capture(alpha, beta, radiusMul, targetY, w, h, focus) {
        capturing = true;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        engine.setSize(w, h);

        camera.detachControl();
        camera.useAutoRotationBehavior = false;
        camera.inertia = 0;
        camera.inertialAlphaOffset = 0;
        camera.inertialBetaOffset = 0;
        camera.inertialRadiusOffset = 0;
        // setTarget recomputes radius to preserve position, so target goes FIRST
        const f = focus || char.root.position;
        camera.setTarget(new B.Vector3(f.x, H * targetY, f.z));
        camera.alpha = alpha;
        camera.beta = beta;
        camera.radius = H * radiusMul;

        scene.render();
        scene.render();
        const out = { png: canvas.toDataURL('image/png'),
                      cam: { a: camera.alpha, b: camera.beta, r: camera.radius } };
        capturing = false;
        return out;
      },
      /* freeze the rig in neutral for clean model shots */
      rest() { player.setEnabled(false); player.animator.rest(); scene.render(); },
      /* hold a walk pose at a given cycle phase, without moving */
      pose(phase, speed) {
        player.setEnabled(false);
        player.animator.rest();
        const s = speed === undefined ? player.cfg.walkSpeed : speed;
        // walk the animator forward to the requested phase at a fixed speed,
        // in small steps so the idle->walk blend settles
        const steps = 90;
        const dist = (phase / (Math.PI * 2)) * 1.05;   // stride, see animation.js
        for (let i = 0; i < steps; i++) {
          player.animator.update((dist / s) / steps, s, player.cfg.runSpeed);
        }
        scene.render();
      }
    };
  });
})();
