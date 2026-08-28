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
    radius:    0.34,    // collision radius

    /* jumpSpeed^2 / (2 * gravity) = apex height, currently ~0.81 units against
     * a 1.4-unit character, with about 0.7s of air time. */
    jumpSpeed:  4.6,
    gravity:    13.0,
    airControl: 0.55,   // fraction of ground accel available in the air
    coyote:     0.10,   // grace period to still jump just after walking off
    jumpBuffer: 0.14,   // press registered this early still fires on landing
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

    // vertical state
    let airY = 0, vy = 0, grounded = true;
    let coyoteT = 0, bufferT = 0, jumpLatch = false;

    /* ------------------------------------------------------------- input */
    const CODES = {
      forward: ['KeyW', 'ArrowUp'],
      back:    ['KeyS', 'ArrowDown'],
      left:    ['KeyA', 'ArrowLeft'],
      right:   ['KeyD', 'ArrowRight'],
      run:     ['ShiftLeft', 'ShiftRight'],
      jump:    ['Space']
    };
    const held = (name) => CODES[name].some((c) => keys[c]);

    const onKey = (e, down) => {
      // don't hijack browser shortcuts
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // emote keys fire on the press edge and are not held state
      const emoteName = global.EMOTE_KEYS && global.EMOTE_KEYS[e.code];
      if (emoteName) {
        if (down && !keys[e.code] && enabled) animator.play(emoteName);
        keys[e.code] = down;
        e.preventDefault();
        return;
      }

      const known = Object.values(CODES).some((list) => list.includes(e.code));
      if (!known) return;
      // buffer the press edge, so a jump pressed a hair early still fires
      if (down && !keys[e.code] && CODES.jump.includes(e.code)) bufferT = C.jumpBuffer;
      keys[e.code] = down;
      // releasing jump re-arms it; without this, holding Space bounces
      if (!down && CODES.jump.includes(e.code)) jumpLatch = false;
      // Space scrolls the page and arrows scroll/move focus
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
    const hit = { x: 0, z: 0 };

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
      let rate = mag > 0 ? C.accel : C.decel;
      if (!grounded) rate *= C.airControl;      // less authority mid-air
      const k = Math.min(1, rate * dt / Math.max(top, 0.001));
      vx += (tx - vx) * k;
      vz += (tz - vz) * k;
      if (grounded && Math.hypot(vx, vz) < 0.02) { vx = 0; vz = 0; }

      /* ------------------------------------------------------------ jump */
      coyoteT = grounded ? C.coyote : Math.max(0, coyoteT - dt);
      bufferT = Math.max(0, bufferT - dt);

      if (enabled && bufferT > 0 && coyoteT > 0 && !jumpLatch) {
        vy = C.jumpSpeed;
        grounded = false;
        animator.stopEmote();       // leaving the ground cancels any emote
        jumpLatch = true;       // held Space must not re-fire on landing
        bufferT = 0;
        coyoteT = 0;
      }

      /* Horizontal first, so the vertical solve runs against the position the
       * character actually ended up at. */
      const p = char.root.position;
      const wantX = p.x + vx * dt;
      const wantZ = p.z + vz * dt;

      // Push out of anything solid, and off any platform whose top is above
      // the feet. Velocity is zeroed only on the axis that actually got
      // corrected, so sliding along a wall still works.
      world.resolve(wantX, wantZ, airY, C.radius, hit);
      // Velocity is killed only against permanently solid things. Against a
      // platform you are merely below, position is clamped but speed is kept -
      // otherwise you scrub off all forward motion on the face while rising
      // and can never land on top of anything.
      if (hit.solidX && Math.abs(hit.x - wantX) > 1e-4) vx = 0;
      if (hit.solidZ && Math.abs(hit.z - wantZ) > 1e-4) vz = 0;
      p.x = hit.x;
      p.z = hit.z;

      /* Ground height varies now: props are standable. Query it at the
       * resolved position so walking off a crate starts a fall. */
      const gy = world.groundAt(p.x, p.z, airY);
      if (grounded) {
        if (gy > airY + 0.001 && gy - airY <= 0.22) {
          airY = gy;                       // step up a curb
        } else if (gy < airY - 0.02) {
          grounded = false;                // walked off an edge
          vy = 0;
        } else {
          airY = gy;
        }
      }
      if (!grounded) {
        vy -= C.gravity * dt;
        airY += vy * dt;
        const land = world.groundAt(p.x, p.z, airY);
        if (vy <= 0 && airY <= land) { airY = land; vy = 0; grounded = true; }
      }

      // turn to face travel; shortest arc so it never spins the long way round
      const speed = Math.hypot(vx, vz);
      if (speed > 0.05) {
        const want = Math.atan2(vx, vz);       // character faces +Z
        let d = want - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, C.turnRate * dt);
      }
      char.root.rotation.y = facing;

      animator.update(dt, speed, C.runSpeed, {
        airY, vy, airborne: !grounded,
        surfaceY: world.groundAt(p.x, p.z, airY)
      });

      // camera follows at a lag, so it eases rather than sticking rigidly
      const ty = char.height * C.camera.height + airY;
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
      get airborne() { return !grounded; },
      get airY() { return airY; },
      setEnabled(v) { enabled = v; if (!v) { vx = 0; vz = 0; } },
      teleport(x, z) {
        char.root.position.x = x;
        char.root.position.z = z;
        airY = world.groundAt(x, z, 99);
        camTarget.set(x, char.height * C.camera.height + airY, z);
        vx = 0; vz = 0; vy = 0; grounded = true;
      },
      dispose() {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
      }
    };
  }

  global.createPlayer = createPlayer;
})(window);
