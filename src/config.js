// Every tunable of the ODM gear and the soldier in one place.
export const CFG = {
  physicsHz: 120,
  gravity: 14.5,            // m/s² — a touch above Earth: snappier arcs, closer to the anime's weight
  drag: 0.0026,             // quadratic air drag (1/m): terminal fall ≈ 75 m/s
  hardCap: 105,             // above this the drag ramps hard
  radius: 0.5,              // collision sphere around the body centre
  hook: {
    range: 115,             // max anchor distance from the launcher
    speed: 300,             // anchor flight speed
    retract: 420,           // wire wind-back speed after release / miss
    minLen: 1.8,            // the reel stops this close to an anchor
    spread: 0.022,          // radians: both-hooks fire either side of the aim point
  },
  reel: {
    accel: 32, maxIn: 36,           // the gas-driven winch, always running while anchored
    boostAccel: 72, boostMaxIn: 64, // with the gas trigger held
    near: 7,                        // reel tapers inside this distance (no face-plants)
    arrive: 13, brake: 65, brakeMax: 150, // head-on arrival speed / gas-brake decel
    twinShare: 0.62,                // each wire's share when both are anchored
  },
  gas: {
    capacity: 1,
    boostAccel: 26,         // free-flight thrust
    hookedBoostAccel: 11,   // extra steering thrust while reeling
    dashDv: 16, dashCost: 0.035, dashCooldown: 0.45,
    boostRate: 0.05,        // per second while boosting
    reelRate: 0.004,        // per second per anchored wire
    fireCost: 0.003,
  },
  air: { control: 7, pump: 10 },
  ground: { run: 11, accel: 80, skid: 22, jump: 7.8, coyote: 0.12 },
  impact: { safe: 30, dmg: 0.022, stun: 48 },
  wire: { snapSpeed: 7, rebound: 0.08 },   // a wire snapping taut faster than this kicks back a little
  modelLift: 0.4,           // the model's body centre sits this far above the collision sphere's centre
  horse: { mountRadius: 2.6, mountTime: 0.72, maxMountSpeed: 24, leap: 9.5, ropeLeap: 5, leapForward: 2 },
  perch: { reach: 6, maxSpeed: 25, clingTime: 1.8 },   // keep holding a rope, come in slowly: land on it
  kill: { slowmo: 0.9, camTime: 1.05, camCooldown: 2.5 },   // the nape-cut moment
  release: { boost: 7, lift: 3, flipTime: 0.6 },   // a well-timed release (bottom of the swing) slings you out
  aim: { cone: 0.55, facingWeight: 3.2, banTime: 4 },   // ropes go where you face (cos of the cone edge)
  keys: {
    turnGround: 2.7, turnAir: 1.9, turnRope: 1.6,   // rad/s heading turn from ← →
    followRate: 1.1,                                // airborne heading eases toward the flight direction
    payout: 7,                                      // m/s the wire pays out while holding ↓ on a rope
    releaseLift: 2.2,                               // m/s upward flick when letting go at speed
    yawOffsets: [0.12, 0.38, 0.65, 0.95, 1.3],      // rope auto-target fan, radians toward that rope's side
    pitches: [0.1, 0.32, 0.55, 0.8],
    pitchesHigh: [-0.45, -0.2, 0.05, 0.3],
  },
  cam: { dist: 4.4, height: 0.95, side: 0.6, fov: 70, fovMax: 98, sens: 0.0021, lagRate: 22 },
  combat: {
    slashTime: 0.3, reach: 2.6, dmgBase: 40, dmgPerMs: 12.5,
    wear: 0.11, spinMinSpeed: 16, spinInterval: 0.09, swapTime: 0.55,
    spares: 4, grabEscapePerPress: 0.2, grabDecay: 0.18,
    // roped to a titan: swoop round behind the neck and through the nape
    swoopRange: 45, swoop: 33, swoopBoost: 44, swoopGain: 5.5, swoopMax: 70,
    primeRange: 18, primeTime: 0.9,   // Space while swooping in: the cut fires on arrival at the nape
  },
};
