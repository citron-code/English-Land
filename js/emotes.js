/*
 * English Land - emotes.
 *
 * Each emote writes target rotations into a pose object for a given progress
 * u (0..1). The animator lerps the rig toward those targets by an envelope
 * weight, so emotes layer over whatever the character is already doing rather
 * than replacing it outright.
 *
 * Arm rotation conventions (see character.js):
 *   rotation.x  negative swings the arm FORWARD and up
 *   rotation.z  LEFT arm negative = outward, RIGHT arm positive = outward
 *               so a raised right arm is roughly +2.5, a raised left arm -2.5
 *
 * Fields a pose may set (all optional):
 *   armLX armLY armLZ  armRX armRY armRZ
 *   headX headY headZ  bodyX bodyY bodyZ
 *   rootY   extra height, added on top of the walk bob
 *   thumbR  show the right thumb
 *   lookUp  drive the idle glance upward (used by "think")
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  const EMOTES = {
    /* ------------------------------------------------------------- wave */
    wave: {
      key: 'KeyZ', label: 'wave', dur: 2.0, easeIn: 0.22, easeOut: 0.28,
      pose(u, o) {
        // three swings, tapering off toward the end
        const swing = Math.sin(u * TAU * 3) * 0.30 * (1 - u * 0.35);
        o.armRX = -0.12;
        o.armRZ = 2.52 + swing;
        o.headY = 0.14;                  // glance toward whoever is waved at
        o.headZ = -0.07;
        o.bodyZ = -0.035;
        o.bodyY = -0.05;
      }
    },

    /* -------------------------------------------------------- thumbs up */
    thumbsUp: {
      key: 'KeyX', label: 'thumbs up', dur: 1.7, easeIn: 0.16, easeOut: 0.26,
      pose(u, o, char) {
        // one confident push up, then hold
        const push = Math.min(1, u / 0.28);
        const bounce = Math.sin(Math.min(u / 0.45, 1) * Math.PI) * 0.035;
        o.armRX = char.cfg.hand.thumbPoseX * push;   // matches the thumb's tilt
        o.armRZ = 0.42 * push;
        o.thumbR = true;
        o.headX = -0.06;
        o.headZ = -0.05;
        o.bodyX = -0.04;
        o.rootY = bounce;
      }
    },

    /* ------------------------------------------------------------- clap */
    clap: {
      key: 'KeyC', label: 'clap', dur: 1.9, easeIn: 0.14, easeOut: 0.22,
      pose(u, o) {
        // hands meet whenever the sine hits zero: four claps
        const sep = Math.abs(Math.sin(u * Math.PI * 4)) * 0.34;
        o.armLX = -1.32;
        o.armRX = -1.32;
        o.armLZ =  0.46 - sep;           // left swings inward (+z)
        o.armRZ = -0.46 + sep;           // right swings inward (-z)
        o.bodyX = 0.05;
        o.headX = 0.05;
        o.rootY = Math.abs(Math.sin(u * Math.PI * 4)) * 0.016;
      }
    },

    /* -------------------------------------------------------------- nod */
    nod: {
      key: 'KeyV', label: 'yes', dur: 1.4, easeIn: 0.14, easeOut: 0.20,
      pose(u, o) {
        // starts by going DOWN, which is what reads as agreement
        const n = Math.sin(u * TAU * 2.5);
        o.headX = n * 0.30;
        o.bodyX = n * 0.05;
      }
    },

    /* ------------------------------------------------------------ shake */
    shake: {
      key: 'KeyQ', label: 'no', dur: 1.4, easeIn: 0.14, easeOut: 0.20,
      pose(u, o) {
        const n = Math.sin(u * TAU * 2.5);
        o.headY = n * 0.46;
        o.bodyY = n * 0.10;
        o.headZ = n * 0.06;
      }
    },

    /* ------------------------------------------------------------ think */
    think: {
      key: 'KeyE', label: 'think', dur: 2.8, easeIn: 0.30, easeOut: 0.34,
      pose(u, o) {
        /* Hand comes up to the chin. There is no elbow, so pitch alone leaves
         * the hand out at shoulder width - rotation.z has to swing the whole
         * arm inward as well. Babylon composes rotation as Y*X*Z, so with
         * x=-1.95, z=-0.62 the arm points (-0.58, 0.30, 0.76), putting the
         * hand just right of centre at chin height. */
        const up = Math.min(1, u / 0.30);
        o.armRX = -2.06 * up;
        o.armRZ = -0.58 * up;
        o.headX = -0.10;
        o.headZ = 0.16;
        o.headY = 0.12;
        o.bodyZ = 0.05;
        o.lookUp = true;
        // a small ponder sway once the hand is in place
        o.bodyY = Math.sin(u * TAU * 1.2) * 0.05 * up;
      }
    }
  };

  // KeyCode -> emote name, built from the table so there is one source of truth
  const KEY_MAP = {};
  for (const name of Object.keys(EMOTES)) KEY_MAP[EMOTES[name].key] = name;

  global.EMOTES = EMOTES;
  global.EMOTE_KEYS = KEY_MAP;
})(window);
