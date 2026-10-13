# Eren vs Reiner — The Betrayal (prototype chapter)

**Playable page:** [/duel/](/duel/) (in a deployed Vercel preview, append /duel/ to the deployment URL). The original scout/ODM game at / remains unchanged. This branch is **not** merged into main.

## Story beats and features

An independent story-mode encounter inspired by Season 2 episodes **Warrior / Close Combat**: Reiner and Bertholdt reveal their identities near Wall Rose; Eren's Attack Titan clashes with Reiner's Armored Titan; Eren learns that punches alone don't work and uses Annie's grappling technique; Mikasa targets an exposed knee; Bertholdt's Colossal Titan interrupts.

It currently has a procedural battlefield and two articulated Titan models, telegraphed enemy hooks/crosses/grabs/charges, sprinting, stamina, combos, blocking and short parry windows, evasive rolls, grappling throws, staged armor damage, Mikasa's contextual strike, cinematic camera, screen shake, generated impact audio, debris, and the final hold sequence.

**Controls:** WASD/arrows to move · Shift to sprint · J or left-click to punch · K heavy punch · L or right-click to guard (time for parry) · Space to dodge · E to grapple (hold E in the final lock) · F to summon Mikasa when her prompt appears · R restart. Touch buttons are provided on narrower displays.

**Win condition:** Break Reiner's armor using joint grapples/counters, use Mikasa when available, then get close and **hold E** during the final lock. Eren can lose if he takes too much damage. Reiner's warning labels tell you when to guard or evade.

## Testing

The game uses only existing repo-local Three.js assets and runs as a static site; no package build is required.

Run it locally from the repository root:

    python3 -m http.server 8080

Open http://127.0.0.1:8080/duel/

Optional headless smoke + deterministic phase regression test (requires Chromium install once):

    npm install --no-save playwright
    npx playwright install chromium
    node duel/qa-browser.mjs

The QA script verifies loading, sprint reach, Reiner AI damage, armor damage, Mika​sa's assist, phase changes, completion, restart, and absence of browser errors. It temporarily instruments the page response in the test browser rather than injecting QA shortcuts into shipped code.

This is still a **fan-made playable prototype**, not a full animation-quality reconstruction, and should be visually tested with hardware-accelerated rendering in addition to these regression tests.
