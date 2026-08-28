/*
 * English Land - procedural character animation.
 *
 * Two poses, idle and walk, cross-faded by `blend`. Nothing is keyframed: the
 * walk cycle is driven by a phase that advances with DISTANCE TRAVELLED, not
 * with time, so the feet stay in step with the movement speed at any pace and
 * the character never skates.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    // metres of travel per full two-step cycle; smaller = faster stepping
    stride: 1.05,

    walk: {
      leg:    0.62,   // hip swing, radians at full speed
      arm:    0.50,   // shoulder swing (opposes the legs)
      armOut: 0.05,   // arms lift away from the body while moving
      bob:    0.032,  // vertical bounce, twice per cycle
      twist:  0.10,   // torso counter-rotation
      roll:   0.045,  // side-to-side weight shift
      lean:   0.13,   // forward lean into the walk
      headBob:0.035
    },

    idle: {
      breathe: 0.010,
      sway:    0.022,
      armSway: 0.045,
      rate:    1.55
    },

    blendRate: 9      // how fast idle <-> walk cross-fades
  };

  function createAnimator(char, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    C.walk = Object.assign({}, DEFAULTS.walk, (overrides || {}).walk);
    C.idle = Object.assign({}, DEFAULTS.idle, (overrides || {}).idle);

    const baseY = char.groundOffset;
    const armRestX = char.armL.rotation.x;      // built-in forward tilt
    let phase = 0;      // walk cycle position
    let t = 0;          // idle clock
    let blend = 0;      // 0 = idle, 1 = walking

    return {
      get phase() { return phase; },

      /* dt: seconds. speed: current ground speed. maxSpeed: for normalising. */
      update(dt, speed, maxSpeed) {
        t += dt;

        const moving = speed > 0.02;
        const target = moving ? 1 : 0;
        blend += (target - blend) * Math.min(1, dt * C.blendRate);

        // Advance by distance, not time - this is what keeps the feet from
        // sliding when the character accelerates or walks at a partial speed.
        if (moving) phase += (speed * dt / C.stride) * Math.PI * 2;

        const norm = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
        const amp  = blend * (0.45 + 0.55 * norm);   // scale swing with pace

        const s  = Math.sin(phase);
        const c  = Math.cos(phase);
        const s2 = Math.sin(phase * 2);

        const W = C.walk, I = C.idle;
        const idleAmt = 1 - blend;
        const breathe = Math.sin(t * I.rate);

        /* legs: straight-leg hip swing, opposed */
        char.legL.rotation.x =  s * W.leg * amp;
        char.legR.rotation.x = -s * W.leg * amp;

        /* arms: opposite the legs, and lifted slightly clear while moving */
        char.armL.rotation.x = armRestX - s * W.arm * amp
                             + idleAmt * Math.sin(t * I.rate * 0.9) * I.armSway;
        char.armR.rotation.x = armRestX + s * W.arm * amp
                             + idleAmt * Math.sin(t * I.rate * 0.9 + 0.6) * I.armSway;
        char.armL.rotation.z = -W.armOut * amp;
        char.armR.rotation.z =  W.armOut * amp;

        /* upper body: lean into the walk, twist against the legs, roll with
         * the weight shift. bodyPivot is at the hips so the feet stay put. */
        char.bodyPivot.rotation.x = W.lean * amp;
        char.bodyPivot.rotation.y = -s * W.twist * amp;
        char.bodyPivot.rotation.z = c * W.roll * amp
                                  + idleAmt * breathe * I.sway * 0.35;

        /* head: counter-bob, and a slow idle drift */
        char.headPivot.rotation.x = -s2 * W.headBob * amp
                                  + idleAmt * (Math.sin(t * 1.05) * 0.030 - 0.015);
        char.headPivot.rotation.z = -char.bodyPivot.rotation.y * 0.45
                                  + idleAmt * Math.sin(t * 0.8) * 0.020;

        /* vertical bounce: two peaks per cycle, at the leg-crossing points */
        const bob = Math.abs(Math.sin(phase)) * W.bob * amp
                  + idleAmt * breathe * C.idle.breathe;
        char.root.position.y = baseY + bob;

        // the contact shadow lives on the ground, so undo the bounce for it
        if (char.contact) char.contact.position.y = 0.004 - char.root.position.y;
      },

      /* park the rig in a clean neutral pose (used for screenshots) */
      rest() {
        blend = 0; phase = 0; t = 0;
        char.legL.rotation.set(0, 0, 0);
        char.legR.rotation.set(0, 0, 0);
        char.armL.rotation.set(armRestX, 0, 0);
        char.armR.rotation.set(armRestX, 0, 0);
        char.bodyPivot.rotation.set(0, 0, 0);
        char.headPivot.rotation.set(0, 0, 0);
        char.root.position.y = baseY;
        if (char.contact) char.contact.position.y = 0.004 - baseY;
      }
    };
  }

  global.createAnimator = createAnimator;
})(window);
