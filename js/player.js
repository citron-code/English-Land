/*
 * English Land - player movement.
 *
 * Camera-relative movement: pressing "forward" walks away from the camera
 * whichever way it is facing, which is what every third-person game does and
 * what players expect. The character turns to face travel direction with a
 * shortest-arc rotation, and is clamped to the platform.
 */
(function (global) {
  'use strict';
  const B = global.BABYLON;

  const DEFAULTS = {
    walkSpeed: 2.6,
    runSpeed:  4.6,
    accel:     14,      // ground acceleration, units/s^2
    decel:     18,
    turnRate:  11,      // radians/s toward the travel direction
    edgePad:   0.55,    // keep this far from the platform rim
    camera: {
      height: 0.62,     // fraction of character height the camera looks at
      lag:    9         // how quickly the camera target chases the player
    }
  };

  function createPlayer(scene, char, camera, world, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    C.camera = Object.assign({}, DEFAULTS.camera, (overrides || {}).camera);

    const animator = global.createAnimator(char);
    const keys = Object.create(null);
    let vx = 0, vz = 0;
    let facing = char.root.rotation.y;
    let enabled = true;

    /* ------------------------------------------------------------- input */
    const CODES = {
      forward: ['KeyW', 'ArrowUp'],
      back:    ['KeyS', 'ArrowDown'],
      left:    ['KeyA', 'ArrowLeft'],
      right:   ['KeyD', 'ArrowRight'],
      run:     ['ShiftLeft', 'ShiftRight']
    };
    const held = (name) => CODES[name].some((c) => keys[c]);

    const onKey = (e, down) => {
      // don't hijack browser shortcuts
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const known = Object.values(CODES).some((list) => list.includes(e.code));
      if (!known) return;
      keys[e.code] = down;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    // dropping focus mid-stride would otherwise leave the key stuck down
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    /* --------------------------------------------------------- movement */
    const camTarget = new B.Vector3(0, char.height * C.camera.height, 0);
    const fwd = new B.Vector3();
    const right = new B.Vector3();

    function update(dt) {
      // clamp dt: a background tab resumes with a huge delta and teleports you
      dt = Math.min(dt, 0.05);

      let ix = 0, iz = 0;
      if (enabled) {
        if (held('forward')) iz += 1;
        if (held('back'))    iz -= 1;
        if (held('right'))   ix += 1;
        if (held('left'))    ix -= 1;
      }

      // camera-relative basis, flattened onto the ground plane
      camera.getDirectionToRef(B.Axis.Z, fwd);
      fwd.y = 0;
      if (fwd.lengthSquared() < 1e-6) fwd.set(0, 0, 1);
      fwd.normalize();
      right.set(fwd.z, 0, -fwd.x);        // 90 degrees clockwise about +Y

      let dx = right.x * ix + fwd.x * iz;
      let dz = right.z * ix + fwd.z * iz;
      const mag = Math.hypot(dx, dz);
      if (mag > 1e-6) { dx /= mag; dz /= mag; }   // no diagonal speed bonus

      const top = held('run') ? C.runSpeed : C.walkSpeed;
      const tx = dx * top, tz = dz * top;
      const rate = mag > 0 ? C.accel : C.decel;
      const k = Math.min(1, rate * dt / Math.max(top, 0.001));
      vx += (tx - vx) * k;
      vz += (tz - vz) * k;
      if (Math.hypot(vx, vz) < 0.02) { vx = 0; vz = 0; }

      const p = char.root.position;
      p.x += vx * dt;
      p.z += vz * dt;

      // keep the player on the platform
      const b = world.bounds, pad = C.edgePad;
      if (p.x < b.minX + pad) { p.x = b.minX + pad; vx = 0; }
      if (p.x > b.maxX - pad) { p.x = b.maxX - pad; vx = 0; }
      if (p.z < b.minZ + pad) { p.z = b.minZ + pad; vz = 0; }
      if (p.z > b.maxZ - pad) { p.z = b.maxZ - pad; vz = 0; }

      // turn to face travel; shortest arc so it never spins the long way round
      const speed = Math.hypot(vx, vz);
      if (speed > 0.05) {
        const want = Math.atan2(vx, vz);       // character faces +Z
        let d = want - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, C.turnRate * dt);
      }
      char.root.rotation.y = facing;

      animator.update(dt, speed, C.runSpeed);

      // camera follows at a lag, so it eases rather than sticking rigidly
      const ty = char.height * C.camera.height;
      camTarget.x += (p.x - camTarget.x) * Math.min(1, C.camera.lag * dt);
      camTarget.z += (p.z - camTarget.z) * Math.min(1, C.camera.lag * dt);
      camTarget.y += (ty  - camTarget.y) * Math.min(1, C.camera.lag * dt);
      camera.setTarget(camTarget);

      return speed;
    }

    return {
      update, animator, cfg: C,
      get speed() { return Math.hypot(vx, vz); },
      get moving() { return Math.hypot(vx, vz) > 0.05; },
      setEnabled(v) { enabled = v; if (!v) { vx = 0; vz = 0; } },
      teleport(x, z) {
        char.root.position.x = x;
        char.root.position.z = z;
        camTarget.set(x, char.height * C.camera.height, z);
        vx = 0; vz = 0;
      },
      dispose() {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
      }
    };
  }

  global.createPlayer = createPlayer;
})(window);
