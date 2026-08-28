/*
 * English Land - procedural character animation.
 *
 * Poses are layered rather than keyframed:
 *
 *   locomotion  idle <-> walk, cross-faded by `blend`
 *   airborne    jump/fall pose, cross-faded over the top by `air`
 *   idle life   blinking, glancing around, weight shifts, an occasional
 *               stretch - all on independent timers so they never sync up
 *
 * The walk phase advances with DISTANCE TRAVELLED, not time, so the feet stay
 * in step at any speed and the character never skates.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    // metres of travel per full two-step cycle; smaller = faster stepping
    stride: 1.05,

    walk: {
      leg: 0.62, arm: 0.50, armOut: 0.05,
      bob: 0.032, twist: 0.10, roll: 0.045, lean: 0.13, headBob: 0.035
    },

    idle: {
      breathe: 0.010, sway: 0.022, armSway: 0.045, rate: 1.55
    },

    /* Eyes shut and reopen fast; the pause between is long and irregular.
     * A fixed interval reads as a machine, so this jitters and sometimes
     * fires twice in quick succession. */
    blink: {
      every: [2.2, 6.4], dur: 0.12, close: 0.94, doubleChance: 0.28, doubleGap: 0.17
    },

    /* Glances: the head turns to a random point, holds, then drifts back. */
    look: {
      every: [1.8, 4.6], yaw: 0.62, pitch: 0.20,
      ease: 3.4, centreChance: 0.42
    },

    /* Slow weight shift from one foot to the other. */
    shift: { every: [3.0, 6.5], amount: 0.045, ease: 1.6 },

    /* After standing still a while, a bigger one-off motion. */
    stretch: { after: [10, 18], dur: 2.6, arm: 2.15, arch: 0.17, head: 0.24, rise: 0.022 },

    air: {
      tuckFront: -0.62, tuckBack: 0.34, armRise: -1.35, armOut: 0.22,
      leanRise: -0.10, leanFall: 0.16,
      land: { squash: 0.17, dur: 0.24 }
    },

    blendRate: 9,
    airRate: 14
  };

  function createAnimator(char, overrides) {
    const C = Object.assign({}, DEFAULTS, overrides || {});
    for (const k of ['walk', 'idle', 'blink', 'look', 'shift', 'stretch', 'air']) {
      C[k] = Object.assign({}, DEFAULTS[k], (overrides || {})[k]);
    }

    const baseY = char.groundOffset;
    const armRestX = char.armL.rotation.x;
    const contact = char.contact;
    const contactAlpha = contact ? contact.material.alpha : 0;

    const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);

    let phase = 0, t = 0, blend = 0, air = 0;
    let stillFor = 0;

    // blink state
    let blinkWait = rnd(C.blink.every), blinkT = -1, blinkQueued = 0;
    // glance state
    let lookWait = rnd(C.look.every), lookYaw = 0, lookPitch = 0;
    let curYaw = 0, curPitch = 0;
    // weight shift
    let shiftWait = rnd(C.shift.every), shiftTo = 0, shiftCur = 0;
    // stretch
    let stretchAt = rnd(C.stretch.after), stretchT = -1;
    // landing recoil
    let landT = 0, wasAir = false;

    function setEyeLids(k) {
      char.parts.eyeL.scaling.y = k;
      char.parts.eyeR.scaling.y = k;
    }

    return {
      get phase() { return phase; },

      /*
       * dt       seconds
       * speed    current ground speed
       * maxSpeed for normalising the swing amplitude
       * st       { airY, vy, airborne } from the player controller
       */
      update(dt, speed, maxSpeed, st) {
        t += dt;
        st = st || {};
        const airY = st.airY || 0;
        const airborne = !!st.airborne;

        const moving = speed > 0.02;
        blend += ((moving ? 1 : 0) - blend) * Math.min(1, dt * C.blendRate);
        air   += ((airborne ? 1 : 0) - air) * Math.min(1, dt * C.airRate);

        // landing recoil: fired on the airborne -> grounded transition
        if (wasAir && !airborne) landT = C.air.land.dur;
        wasAir = airborne;
        if (landT > 0) landT = Math.max(0, landT - dt);

        if (moving) phase += (speed * dt / C.stride) * Math.PI * 2;

        const norm = maxSpeed > 0 ? Math.min(1, speed / maxSpeed) : 0;
        const amp  = blend * (0.45 + 0.55 * norm) * (1 - air);
        const idleAmt = (1 - blend) * (1 - air);

        const s = Math.sin(phase), c = Math.cos(phase), s2 = Math.sin(phase * 2);
        const W = C.walk, I = C.idle;
        const breathe = Math.sin(t * I.rate);

        /* ---------------------------------------------------- idle "life" */
        // these only run while standing on the ground
        stillFor = (moving || airborne) ? 0 : stillFor + dt;

        // blink - runs even while walking; eyes are always alive
        blinkWait -= dt;
        if (blinkT < 0 && blinkWait <= 0) {
          blinkT = 0;
          if (blinkQueued > 0) blinkQueued--;
          else if (Math.random() < C.blink.doubleChance) blinkQueued = 1;
        }
        let lid = 1;
        if (blinkT >= 0) {
          blinkT += dt;
          const u = blinkT / C.blink.dur;
          if (u >= 1) {
            blinkT = -1;
            blinkWait = blinkQueued > 0 ? C.blink.doubleGap : rnd(C.blink.every);
          } else {
            lid = 1 - Math.sin(Math.PI * u) * C.blink.close;
          }
        }
        setEyeLids(lid);

        // glances
        lookWait -= dt;
        if (lookWait <= 0) {
          if (Math.random() < C.look.centreChance || lookYaw !== 0) {
            lookYaw = 0; lookPitch = 0;
          } else {
            lookYaw   = (Math.random() * 2 - 1) * C.look.yaw;
            lookPitch = (Math.random() * 2 - 1) * C.look.pitch;
          }
          lookWait = rnd(C.look.every);
        }
        // glancing is an idle behaviour: unwind it when walking or airborne
        const lookK = Math.min(1, dt * C.look.ease);
        curYaw   += ((idleAmt > 0.5 ? lookYaw   : 0) - curYaw)   * lookK;
        curPitch += ((idleAmt > 0.5 ? lookPitch : 0) - curPitch) * lookK;

        // weight shift
        shiftWait -= dt;
        if (shiftWait <= 0) {
          shiftTo = (Math.random() * 2 - 1) * C.shift.amount;
          shiftWait = rnd(C.shift.every);
        }
        shiftCur += ((idleAmt > 0.5 ? shiftTo : 0) - shiftCur) * Math.min(1, dt * C.shift.ease);

        // stretch, once the character has been still long enough
        if (stretchT < 0 && stillFor > stretchAt) stretchT = 0;
        let stretch = 0;
        if (stretchT >= 0) {
          stretchT += dt;
          if (stretchT >= C.stretch.dur || moving || airborne) {
            stretchT = -1;
            stretchAt = rnd(C.stretch.after);
            stillFor = 0;
          } else {
            stretch = Math.sin(Math.PI * (stretchT / C.stretch.dur));
          }
        }
        const S = C.stretch;

        /* --------------------------------------------------------- legs */
        const legGround =  s * W.leg * amp;
        const legAirL = C.air.tuckFront, legAirR = C.air.tuckBack;
        char.legL.rotation.x = legGround * 1 + air * (legAirL - legGround);
        char.legR.rotation.x = -legGround + air * (legAirR + legGround);

        /* --------------------------------------------------------- arms */
        const armIdleL = Math.sin(t * I.rate * 0.9) * I.armSway;
        const armIdleR = Math.sin(t * I.rate * 0.9 + 0.6) * I.armSway;
        const armGroundL = armRestX - s * W.arm * amp + idleAmt * armIdleL - stretch * S.arm;
        const armGroundR = armRestX + s * W.arm * amp + idleAmt * armIdleR - stretch * S.arm;
        // falling reaches down, rising throws the arms up
        const rise = st.vy === undefined ? 1 : (st.vy > 0 ? 1 : 0.35);
        const armAir = armRestX + C.air.armRise * rise;
        char.armL.rotation.x = armGroundL + air * (armAir - armGroundL);
        char.armR.rotation.x = armGroundR + air * (armAir - armGroundR);
        char.armL.rotation.z = -W.armOut * amp - air * C.air.armOut - stretch * 0.10;
        char.armR.rotation.z =  W.armOut * amp + air * C.air.armOut + stretch * 0.10;

        /* --------------------------------------------------- upper body */
        const leanAir = st.vy === undefined ? 0
          : (st.vy > 0 ? C.air.leanRise : C.air.leanFall);
        const leanGround = W.lean * amp - stretch * S.arch;
        char.bodyPivot.rotation.x = leanGround + air * (leanAir - leanGround);
        char.bodyPivot.rotation.y = (-s * W.twist * amp) * (1 - air) + curYaw * 0.25;
        char.bodyPivot.rotation.z = (c * W.roll * amp + idleAmt * breathe * I.sway * 0.35
                                     + shiftCur) * (1 - air);

        /* --------------------------------------------------------- head */
        char.headPivot.rotation.x = -s2 * W.headBob * amp
                                  + idleAmt * (Math.sin(t * 1.05) * 0.030 - 0.015)
                                  + curPitch - stretch * S.head;
        char.headPivot.rotation.y = curYaw;
        char.headPivot.rotation.z = -char.bodyPivot.rotation.y * 0.35
                                  + idleAmt * Math.sin(t * 0.8) * 0.020;

        /* ------------------------------------------- height, squash, shadow */
        const bob = (Math.abs(Math.sin(phase)) * W.bob * amp
                   + idleAmt * breathe * C.idle.breathe
                   + stretch * S.rise) * (1 - air);

        // Landing squash scales about the root origin, which sits ABOVE the
        // soles - so the position has to scale with it or the feet lift off.
        const sq = landT > 0 ? (landT / C.air.land.dur) * C.air.land.squash : 0;
        char.root.scaling.y = 1 - sq;
        char.root.scaling.x = char.root.scaling.z = 1 + sq * 0.45;
        char.root.position.y = baseY * (1 - sq) + bob + airY;

        /* The decal is unparented, so it is placed here. It tightens and fades
         * with height, which is what sells the character leaving the ground. */
        if (contact) {
          contact.position.x = char.root.position.x;
          contact.position.z = char.root.position.z;
          contact.position.y = 0.004;
          const k = 1 / (1 + Math.max(0, airY) * 1.7);
          contact.scaling.x = contact.scaling.z = k;
          contact.material.alpha = contactAlpha * k;
        }
      },

      /* park the rig in a clean neutral pose (used for screenshots) */
      rest() {
        blend = 0; phase = 0; t = 0; air = 0; landT = 0; stillFor = 0;
        curYaw = curPitch = lookYaw = lookPitch = 0;
        shiftCur = shiftTo = 0;
        stretchT = -1; blinkT = -1; blinkWait = rnd(C.blink.every);
        char.legL.rotation.set(0, 0, 0);
        char.legR.rotation.set(0, 0, 0);
        char.armL.rotation.set(armRestX, 0, 0);
        char.armR.rotation.set(armRestX, 0, 0);
        char.bodyPivot.rotation.set(0, 0, 0);
        char.headPivot.rotation.set(0, 0, 0);
        char.root.scaling.set(1, 1, 1);
        char.root.position.y = baseY;
        setEyeLids(1);
        if (contact) {
          contact.position.set(char.root.position.x, 0.004, char.root.position.z);
          contact.scaling.set(1, 1, 1);
          contact.material.alpha = contactAlpha;
        }
      },

      /* dev helpers: force a behaviour now, for screenshots */
      forceBlink() { blinkT = 0; blinkWait = 999; },
      forceLook(yaw, pitch) { lookYaw = yaw; lookPitch = pitch; lookWait = 999; },
      forceStretch() { stretchT = 0; stillFor = 999; }
    };
  }

  global.createAnimator = createAnimator;
})(window);
