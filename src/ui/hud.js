// Wings of Freedom HUD: a DOM overlay above the WebGL canvas (owner: hud agent).
// Owns its CSS (injected once as a <style> element) and the Google Fonts link. No three.js dependency.
// update(s) runs every frame: it only writes to the DOM when a displayed value actually changed.

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900'
  + '&family=Inter:ital,wght@0,500;0,700;0,900;1,700;1,900&display=swap';

const CSS = `
.wof-root{--olive:#2f3a24;--olive-d:#171d12;--leather:#5b3d24;--leather-d:#2a1c10;--brass:#c9a25a;--brass-d:#7d6128;
  --parch:#efe6cf;--parch-d:#b7ab8c;--red:#d2402e;--cyan:#62ecff;--yellow:#ffd54a;
  --serif:Cinzel,Georgia,"Times New Roman",serif;--sans:Inter,"Segoe UI","Helvetica Neue",Arial,sans-serif;
  position:fixed;inset:0;z-index:10;pointer-events:none;overflow:hidden;font-family:var(--sans);color:var(--parch);
  -webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.wof-root *{box-sizing:border-box}
.wof-root button{font:inherit;margin:0}
.wof-game{position:absolute;inset:0;pointer-events:none;transition:opacity .4s}
.wof-root.hud-off .wof-game{opacity:0}

.wof-panel,.wof-card{background:linear-gradient(180deg,rgba(54,66,41,.86),rgba(24,30,20,.88));
  border:1px solid var(--leather);border-radius:6px;
  box-shadow:inset 0 0 0 1px rgba(201,162,90,.2),inset 0 1px 0 rgba(255,255,255,.07),0 6px 18px rgba(0,0,0,.45)}
.wof-label{font-family:var(--serif);font-weight:700;font-size:11px;letter-spacing:.2em;color:var(--brass);text-shadow:0 1px 2px #000;white-space:nowrap}
.wof-bar{position:relative;overflow:hidden;background:rgba(10,8,5,.75);border:1.5px solid var(--leather-d);border-radius:3px;
  box-shadow:inset 0 2px 4px rgba(0,0,0,.75),0 0 0 1px rgba(201,162,90,.22)}
.wof-bar-fill{position:absolute;left:0;top:0;bottom:0;right:0;transform-origin:0 50%;transform:scaleX(1)}

/* top-left: crest + HP */
.wof-tl{position:absolute;left:16px;top:14px;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px)}
.wof-crest{width:46px;height:50px;flex:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.wof-tl .wof-label{width:22px}
.wof-hp{width:230px;height:16px}
.wof-hp .wof-bar-fill{background:linear-gradient(180deg,#f27a5c,#b3291c 55%,#6a1209)}
.wof-tl[data-low="1"] .wof-hp{animation:wof-blink .45s ease-in-out infinite alternate}

/* bottom-left column: the controls card (H) stacked above the gas canisters + blades */
.wof-blc{position:absolute;left:16px;bottom:16px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:calc(100vw - 32px)}
.wof-bl{position:relative;padding:10px 14px;display:flex;flex-direction:column;gap:9px;width:330px;max-width:100%}
.wof-cc{display:grid;grid-template-columns:auto auto;gap:4px 9px;align-items:center;padding:8px 12px 8px 10px;font-size:11.5px;line-height:1.2;
  color:var(--parch-d);background:rgba(14,18,11,.5);border:1px solid rgba(201,162,90,.32);border-radius:6px;
  opacity:0;visibility:hidden;transform:translateY(6px);transition:opacity .25s,transform .25s,visibility .25s}
.wof-cc.on{opacity:1;visibility:visible;transform:none}
.wof-cc .k{display:flex;gap:3px;justify-content:flex-end}
.wof-cc .t{white-space:nowrap;text-shadow:0 1px 2px #000}
.wof-cc .t b{color:var(--parch);font-weight:700}
.wof-root .wof-cc kbd{height:18px;min-width:19px;padding:0 4px;font-size:10px;border-bottom-width:2px;border-radius:4px}
.wof-row2{display:flex;align-items:center;gap:10px}
.wof-row2 > .wof-label{width:56px;flex:none}
.wof-canisters{display:flex;gap:6px;flex:1;min-width:0}
.wof-canister{position:relative;flex:1;height:20px;border-radius:10px;overflow:hidden;background:rgba(8,6,3,.8);
  border:1.5px solid #6f4d2c;box-shadow:inset 0 3px 5px rgba(0,0,0,.75),0 0 0 1px rgba(201,162,90,.18)}
.wof-canister .wof-bar-fill{left:0;right:0}
.wof-canister::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(90deg,transparent 0 15px,rgba(0,0,0,.4) 15px 17px)}
.wof-canister-fill.g{background:linear-gradient(180deg,#d7f2a8,#7fb34e 50%,#3d6a20)}
.wof-canister-fill.a{background:linear-gradient(180deg,#ffe596,#e8ac3a 55%,#a46c15)}
.wof-canister-fill.r{background:linear-gradient(180deg,#ffa08c,#d4452f 55%,#7d1d12)}
.wof-canisters.pulse .wof-canister-fill{animation:wof-blink .5s ease-in-out infinite alternate}
.wof-blade{flex:1;height:10px;min-width:0}
.wof-blade .wof-bar-fill{background:linear-gradient(90deg,#8d8779,#ece5cf 70%,#fbf7ea)}
.wof-blade.low .wof-bar-fill{background:linear-gradient(90deg,#6e1e13,#e0603a)}
.wof-spare{font-weight:700;font-size:13px;white-space:nowrap;min-width:48px;text-align:right;text-shadow:0 1px 2px #000;font-variant-numeric:tabular-nums}
.wof-spare i{font-style:normal;color:var(--brass);margin-right:4px}
@keyframes wof-blink{from{opacity:1}to{opacity:.3}}

/* centre: crosshair, hooks, nape markers */
.wof-cross{position:fixed;left:50%;top:50%;width:0;height:0}
.wof-ring{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;
  border:1.5px solid rgba(255,255,255,.9);box-shadow:0 0 6px rgba(255,255,255,.45),inset 0 0 3px rgba(0,0,0,.35);
  transition:opacity .12s,border-color .12s,box-shadow .12s}
.wof-dot{position:absolute;left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%;background:#fff;
  box-shadow:0 0 3px #000;transition:opacity .12s}
.wof-cross[data-valid="0"] .wof-ring{opacity:0}
.wof-cross[data-valid="0"] .wof-dot{opacity:.4}
.wof-cross[data-valid="1"] .wof-ring{opacity:1}
.wof-cross[data-valid="1"] .wof-ring{border-color:#fff;box-shadow:0 0 9px rgba(255,255,255,.75),inset 0 0 3px rgba(0,0,0,.3)}
.wof-x,.wof-lock{position:absolute;left:-30px;top:-30px;width:60px;height:60px;overflow:visible;pointer-events:none;
  opacity:0;transition:opacity .12s}
.wof-cross[data-valid="0"] .wof-x{opacity:1}
.wof-cross[data-lock="1"] .wof-lock{opacity:1}
.wof-dist{position:absolute;left:-40px;top:20px;width:80px;text-align:center;font-weight:600;font-size:11px;letter-spacing:.04em;
  font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 3px #000,0 0 2px #000}
.wof-hook{position:absolute;top:-13px;width:16px;height:34px;color:rgba(205,205,195,.45);transition:color .08s,filter .08s}
.wof-hook[data-side="0"]{left:-64px}
.wof-hook[data-side="1"]{left:48px}
.wof-hook svg{position:absolute;left:0;top:0;width:16px;height:20px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;transition:transform .08s}
.wof-hook span{position:absolute;left:-4px;right:-4px;top:23px;text-align:center;font-weight:700;font-size:10px;letter-spacing:.1em;color:inherit;text-shadow:0 1px 2px #000}
.wof-hook[data-state="flying"]{color:var(--yellow)}
.wof-hook[data-state="attached"]{color:var(--cyan);filter:drop-shadow(0 0 4px rgba(98,236,255,.95))}
.wof-hook[data-state="attached"] svg{transform:scale(1.2)}
.wof-hook[data-side="1"][data-state="attached"]{color:#ffb43c;filter:drop-shadow(0 0 4px rgba(255,180,60,.95))}
.wof-napes{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.wof-nape{position:absolute;left:0;top:0;width:10px;height:10px;background:#e2352a;border:1.5px solid #ffe3d6;
  box-shadow:0 0 7px rgba(255,40,30,.95),0 0 2px #000;will-change:transform}

/* rope target markers (Z = cyan / left, X = amber / right) */
.wof-tgts,.wof-threats{position:absolute;inset:0;pointer-events:none;overflow:hidden;transition:opacity .15s}
.wof-root.grabbed .wof-tgts,.wof-root.grabbed .wof-threats{opacity:0}
.wof-tgt{position:absolute;left:0;top:0;width:0;height:0;display:none;will-change:transform;--c:#62ecff;--g:rgba(98,236,255,.85)}
.wof-tgt[data-side="1"]{--c:#ffb43c;--g:rgba(255,180,60,.85)}
.wof-tgt i{position:absolute;left:-10px;top:-10px;width:20px;height:20px;border:2.5px solid var(--c);transform:rotate(45deg);
  box-shadow:0 0 8px var(--g),inset 0 0 5px var(--g),0 0 0 1px rgba(0,0,0,.55)}
.wof-tgt i::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;background:var(--c)}
.wof-tgt b{position:absolute;top:-29px;padding:1px 4px 0;font-weight:900;font-size:11px;line-height:13px;color:#0d1418;background:var(--c);
  border-radius:3px;box-shadow:0 0 6px var(--g),0 1px 0 #000}
.wof-tgt[data-side="0"] b{right:7px}
.wof-tgt[data-side="1"] b{left:7px}
.wof-tgt[data-att="1"] i{background:var(--c);animation:wof-tgt-pulse .7s ease-in-out infinite}
.wof-tgt[data-att="1"] i::after{background:#fff}
@keyframes wof-tgt-pulse{0%,100%{transform:rotate(45deg) scale(1)}50%{transform:rotate(45deg) scale(1.32);box-shadow:0 0 18px var(--g),0 0 0 1px rgba(0,0,0,.5)}}

/* off-screen titan threat chevrons */
.wof-thr{position:absolute;left:0;top:0;width:0;height:0;display:none;will-change:transform}
.wof-thr svg{position:absolute;left:-11px;top:-9px;width:22px;height:18px;overflow:visible;fill:#e3402b;stroke:#2a0703;stroke-width:1.4;
  stroke-linejoin:round;filter:drop-shadow(0 0 4px rgba(255,40,20,.85))}
.wof-thr.danger svg{fill:#ff6a40;animation:wof-thr-pulse .38s ease-in-out infinite alternate}
@keyframes wof-thr-pulse{from{transform:scale(1.5);opacity:1}to{transform:scale(1.95);opacity:.65}}

/* bottom-right: speed, kills, score, combo */
.wof-br{position:absolute;right:16px;bottom:16px;padding:10px 16px 10px;text-align:right;min-width:184px}
.wof-combo{min-height:24px;font-family:var(--serif);font-weight:900;font-size:19px;letter-spacing:.12em;color:var(--brass);
  text-shadow:0 0 10px rgba(201,162,90,.55),0 2px 2px #000;opacity:0;transition:opacity .2s}
.wof-combo.on{opacity:1}
.wof-speed-row{display:flex;align-items:baseline;justify-content:flex-end}
.wof-speed{font-weight:900;font-style:italic;font-size:56px;line-height:.95;letter-spacing:-.02em;font-variant-numeric:tabular-nums;
  text-shadow:0 2px 0 rgba(0,0,0,.55),0 0 14px rgba(0,0,0,.6)}
.wof-unit{font-family:var(--serif);font-weight:700;font-size:12px;letter-spacing:.22em;color:var(--brass);margin-left:8px;text-shadow:0 1px 2px #000}
.wof-stat{display:flex;justify-content:space-between;align-items:baseline;gap:18px;margin-top:6px}
.wof-stat span{font-family:var(--serif);font-size:11px;letter-spacing:.2em;color:var(--parch-d)}
.wof-stat b{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000}

/* top-centre objective and toast */
.wof-obj{position:absolute;left:50%;top:14px;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:6px 16px;
  font-family:var(--serif);font-weight:700;font-size:13px;letter-spacing:.16em;text-transform:uppercase;text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .3s}
.wof-obj.on{opacity:1}
.wof-toast{position:absolute;left:50%;top:66px;transform:translate(-50%,-6px);padding:9px 20px;max-width:calc(100vw - 32px);
  font-family:var(--serif);font-weight:700;font-size:16px;letter-spacing:.06em;text-align:center;border-radius:4px;
  opacity:0;transition:opacity .25s,transform .25s;box-shadow:0 6px 16px rgba(0,0,0,.5)}
.wof-toast.on{opacity:1;transform:translate(-50%,0)}
.wof-toast.info{background:linear-gradient(180deg,rgba(54,66,41,.94),rgba(24,30,20,.94));border:1px solid var(--brass-d);color:var(--parch)}
.wof-toast.warn{background:linear-gradient(180deg,rgba(158,40,26,.95),rgba(92,16,10,.95));border:1px solid #ff8a72;color:#fff1e6}
.wof-toast.warn.on{animation:wof-shake .4s}

/* right: squad radio + kill feed */
.wof-feed{position:absolute;right:16px;top:96px;display:flex;flex-direction:column;align-items:flex-end;gap:5px;pointer-events:none;max-width:min(380px,calc(100vw - 32px))}
.wof-feed div{padding:5px 11px;font-size:13px;line-height:1.3;color:var(--parch);background:linear-gradient(90deg,rgba(20,24,16,.0),rgba(20,24,16,.78) 18%);border-right:3px solid var(--brass-d);
  text-shadow:0 1px 2px #000;opacity:0;transform:translateX(14px);transition:opacity .25s,transform .25s}
.wof-feed div.on{opacity:1;transform:none}
.wof-feed div.kill{border-right-color:#ffd24a}.wof-feed div.warn{border-right-color:#ff6a50;color:#ffe2d8}.wof-feed div.radio{font-style:italic}
.wof-feed b{color:#ffd98a;font-style:normal}
/* top-right: training clock + dummies left */
.wof-tr{position:absolute;right:16px;top:14px;padding:6px 14px 7px;min-width:156px;display:none}
.wof-tr.on{display:block}
.wof-tr-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.wof-tr-row[hidden]{display:none}
.wof-tr-row + .wof-tr-row{margin-top:2px}
.wof-tr-row span{font-family:var(--serif);font-weight:700;font-size:11px;letter-spacing:.2em;color:var(--brass);text-shadow:0 1px 2px #000}
.wof-tr-row b{font-weight:900;font-style:italic;font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.55)}
.wof-tr-row b.sm{font-size:18px}

/* bottom-centre tutorial hint */
.wof-hint{position:absolute;left:50%;bottom:24px;display:flex;align-items:center;gap:12px;padding:8px 18px 8px 10px;
  max-width:min(600px,calc(100vw - 710px));min-width:min(260px,calc(100vw - 32px));font-weight:700;font-size:15px;line-height:1.25;color:#fff;text-shadow:0 1px 2px #000;
  background:rgba(10,12,8,.74);border:1px solid rgba(201,162,90,.55);border-radius:26px;box-shadow:0 6px 18px rgba(0,0,0,.5);
  opacity:0;transform:translate(-50%,10px);transition:opacity .22s,transform .22s}
.wof-hint.on{opacity:1;transform:translate(-50%,0)}
.wof-root.grabbed .wof-hint{opacity:0}
.wof-hint .ks{display:flex;gap:5px;flex:none}
.wof-root .wof-hint kbd{height:28px;min-width:30px;font-size:14px}

/* grabbed: mash prompt + struggle bar + red vignette */
.wof-vig{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .2s;
  background:radial-gradient(ellipse 75% 70% at 50% 50%,transparent 52%,rgba(160,8,0,.6) 100%)}
.wof-root.grabbed .wof-vig{opacity:1;animation:wof-vig .9s ease-in-out infinite alternate}
@keyframes wof-vig{from{opacity:.65}to{opacity:1}}
.wof-grab{position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:12px;
  opacity:0;visibility:hidden;transition:opacity .15s,visibility .15s}
.wof-root.grabbed .wof-grab{opacity:1;visibility:visible}
.wof-grab-t{display:flex;align-items:center;gap:16px;font-family:var(--serif);font-weight:900;font-size:clamp(28px,5vw,56px);letter-spacing:.14em;
  color:#fff3e0;text-shadow:0 3px 0 #2a0703,0 0 22px rgba(230,40,20,.9);white-space:nowrap;animation:wof-mash .3s ease-in-out infinite alternate}
.wof-root .wof-grab-t kbd{height:auto;padding:8px 0;min-width:clamp(120px,16vw,200px);font-size:clamp(16px,2.4vw,24px);letter-spacing:.1em;
  border-color:#ff8a72;border-bottom-width:5px;animation:wof-press .15s ease-in-out infinite alternate}
@keyframes wof-mash{from{transform:scale(1)}to{transform:scale(1.07)}}
@keyframes wof-press{from{transform:translateY(0)}to{transform:translateY(3px);border-bottom-width:2px}}
.wof-grab-bar{width:min(360px,72vw);height:14px}
.wof-grab-bar .wof-bar-fill{background:linear-gradient(90deg,#ff5a3a,#ffd54a 70%,#fff6d0);transform:scaleX(0)}
.wof-grab-s{font-family:var(--serif);font-weight:700;font-size:12px;letter-spacing:.3em;color:#ffd0c4;text-shadow:0 1px 2px #000}
@keyframes wof-shake{0%,100%{transform:translate(-50%,0)}25%{transform:translate(calc(-50% - 6px),0)}75%{transform:translate(calc(-50% + 6px),0)}}

/* cinematic big message */
.wof-big{position:absolute;left:0;right:0;top:27%;text-align:center;opacity:0;transition:opacity .7s}
.wof-big.on{opacity:1}
.wof-big span{display:inline-block;max-width:94vw;padding-left:.2em;text-wrap:balance;font-family:var(--serif);font-weight:900;line-height:1.15;
  font-size:clamp(20px,4vw,56px);letter-spacing:.2em;color:var(--parch);
  text-shadow:0 3px 0 rgba(0,0,0,.55),0 0 24px rgba(0,0,0,.85),0 0 40px rgba(201,162,90,.35)}
.wof-big i{display:block;height:2px;margin:12px auto 0;width:min(40vw,420px);transform:scaleX(0);
  background:linear-gradient(90deg,transparent,var(--brass),transparent);box-shadow:0 0 8px rgba(201,162,90,.6)}
.wof-big.on span{animation:wof-big-in .9s cubic-bezier(.2,.7,.2,1) both}
.wof-big.on i{animation:wof-line .9s .2s ease-out both}
@keyframes wof-big-in{from{letter-spacing:.6em;opacity:0;transform:scale(1.08)}to{letter-spacing:.2em;opacity:1;transform:scale(1)}}
@keyframes wof-line{to{transform:scaleX(1)}}

/* AoTTG-style damage numbers */
.wof-dmgs{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.wof-dmg{position:absolute;left:0;top:0;transform:translate(-50%,-50%);font-weight:900;font-style:italic;font-size:34px;line-height:1;
  color:#fff8e8;white-space:nowrap;font-variant-numeric:tabular-nums;will-change:transform,opacity;
  text-shadow:-2px -2px 0 #14100b,2px -2px 0 #14100b,-2px 2px 0 #14100b,2px 2px 0 #14100b,0 3px 0 #14100b,0 0 10px rgba(0,0,0,.6);
  animation:wof-dmg 1.2s cubic-bezier(.2,.8,.3,1) forwards}
.wof-dmg.kill{font-size:58px;color:#ffd24a;
  text-shadow:-2px -2px 0 #14100b,2px -2px 0 #14100b,-2px 2px 0 #14100b,2px 2px 0 #14100b,0 4px 0 #14100b,0 0 14px rgba(230,50,30,.95)}
@keyframes wof-dmg{
  0%{opacity:0;transform:translate(-50%,-50%) scale(.35)}
  14%{opacity:1;transform:translate(-50%,-50%) scale(1.22)}
  26%{opacity:1;transform:translate(-50%,-50%) scale(1)}
  70%{opacity:1;transform:translate(-50%,calc(-50% - 26px)) scale(1)}
  100%{opacity:0;transform:translate(-50%,calc(-50% - 70px)) scale(.92)}}

/* full-screen screens: title, pause, death */
.wof-screen{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;pointer-events:none;opacity:0;visibility:hidden;
  transition:opacity .4s,visibility .4s;-webkit-overflow-scrolling:touch}
.wof-screen.on{opacity:1;visibility:visible;pointer-events:auto}
.wof-screen-in{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:28px 16px}
.wof-menu{background:radial-gradient(ellipse 70% 62% at 50% 44%,rgba(8,10,6,.12),rgba(6,8,5,.66) 70%,rgba(3,4,2,.93) 100%)}
.wof-pause{background:rgba(6,8,5,.6);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.wof-death{background:radial-gradient(ellipse 80% 70% at 50% 45%,rgba(78,8,4,.3),rgba(12,2,2,.92) 75%)}
.wof-result{background:radial-gradient(ellipse 80% 70% at 50% 45%,rgba(24,30,16,.3),rgba(4,6,3,.9) 75%)}

.wof-title{margin:0;text-align:center;font-family:var(--serif);font-weight:900;font-size:clamp(34px,7.4vw,88px);line-height:1;
  letter-spacing:.08em;color:var(--parch);text-shadow:0 3px 0 #1a120a,0 0 28px rgba(201,162,90,.45),0 0 2px #000}
.wof-subtitle{margin-top:14px;text-align:center;font-family:var(--serif);font-weight:500;font-size:clamp(11px,1.8vw,15px);
  letter-spacing:.26em;text-transform:uppercase;color:var(--brass);text-shadow:0 1px 2px #000}
.wof-divider{position:relative;width:min(420px,80vw);height:14px;margin:10px 0 0}
.wof-divider::before{content:"";position:absolute;left:0;right:0;top:6px;height:1px;background:linear-gradient(90deg,transparent,var(--brass),transparent)}
.wof-divider::after{content:"";position:absolute;left:50%;top:1px;width:9px;height:9px;margin-left:-4.5px;background:var(--brass);
  transform:rotate(45deg);box-shadow:0 0 8px rgba(201,162,90,.7)}
.wof-menu-btns{display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
.wof-btn{pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:250px;
  padding:14px 26px 13px;border-radius:4px;border:2px solid var(--brass);color:var(--parch);font-family:var(--serif);
  background:linear-gradient(180deg,#5a6e40 0%,#323f25 55%,#1c2415 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.16),inset 0 -2px 0 rgba(0,0,0,.4),0 0 0 1px #0d0a06,0 8px 20px rgba(0,0,0,.55);
  transition:transform .12s,box-shadow .2s,filter .2s}
.wof-btn b{font-weight:900;font-size:20px;letter-spacing:.18em;text-shadow:0 2px 0 #0d0a06}
.wof-btn small{font-family:var(--sans);font-size:12px;letter-spacing:.06em;color:var(--parch-d)}
.wof-btn:hover{transform:translateY(-2px);filter:brightness(1.12);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 0 rgba(0,0,0,.4),0 0 0 1px #0d0a06,0 0 24px rgba(201,162,90,.5)}
.wof-btn:active{transform:translateY(1px)}
.wof-btn:focus{outline:none}
.wof-btn:focus-visible,.wof-btn.sel{outline:2px solid var(--cyan);outline-offset:3px}
.wof-btn.sel{filter:brightness(1.12)}
.wof-menu-btns .wof-btn{min-width:214px;padding:13px 20px 12px}
.wof-btn.alt{background:linear-gradient(180deg,#4a3a26 0%,#2c2015 55%,#170f08 100%);border-color:#8a6a3a}

.wof-card{width:min(760px,100%);padding:20px 24px 22px;display:flex;flex-direction:column;align-items:center}
.wof-card-title{font-family:var(--serif);font-weight:700;font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:var(--brass);
  text-align:center;margin-bottom:12px;text-shadow:0 1px 2px #000}
/* keycaps */
.wof-root kbd{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:26px;height:24px;padding:0 7px;
  font-family:var(--sans);font-weight:800;font-size:12px;line-height:1;letter-spacing:.02em;white-space:nowrap;vertical-align:middle;
  color:#f6ecd2;background:linear-gradient(180deg,#4a3720,#1d140a);border:1px solid #8a6a3a;border-bottom-width:3px;border-radius:5px;
  box-shadow:0 1px 0 #000,inset 0 1px 0 rgba(255,255,255,.12)}
.wof-root kbd.z{border-color:#3fc4dc;color:#d2faff;box-shadow:0 0 8px rgba(98,236,255,.4),0 1px 0 #000,inset 0 1px 0 rgba(255,255,255,.12)}
.wof-root kbd.x{border-color:#e0a33a;color:#ffe9b8;box-shadow:0 0 8px rgba(255,180,60,.4),0 1px 0 #000,inset 0 1px 0 rgba(255,255,255,.12)}
.wof-root kbd.w{min-width:54px}
.wof-root kbd.sp{min-width:104px}

/* controls reference (title + pause): four groups MOVE / ROPES / GAS / CUT */
.wof-ctl{width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.wof-grp{display:flex;flex-direction:column;align-items:center;gap:9px;min-width:0;padding:11px 8px 12px;
  border:1px solid rgba(201,162,90,.28);border-radius:6px;background:rgba(0,0,0,.24)}
.wof-grp-h{font-family:var(--serif);font-weight:900;font-size:15px;letter-spacing:.24em;padding-left:.24em;color:var(--parch);text-shadow:0 1px 2px #000}
.wof-grp-k{display:flex;align-items:flex-end;justify-content:center;gap:6px;height:63px}
.wof-root .wof-grp-k kbd{height:30px;min-width:34px;font-size:15px}
.wof-root .wof-grp-k kbd.w{min-width:70px}
.wof-root .wof-grp-k kbd.sp{min-width:116px}
.wof-arrows{display:grid;grid-template-columns:repeat(3,34px);grid-template-rows:30px 30px;gap:3px}
.wof-arrows kbd:nth-child(1){grid-column:2;grid-row:1}
.wof-arrows kbd:nth-child(2){grid-column:1;grid-row:2}
.wof-arrows kbd:nth-child(3){grid-column:2;grid-row:2}
.wof-arrows kbd:nth-child(4){grid-column:3;grid-row:2}
.wof-grp ul{list-style:none;margin:0;padding:0;font-size:12.5px;line-height:1.4;text-align:center;color:var(--parch-d)}
.wof-grp li b{color:var(--parch);font-weight:800}
.wof-ctl-more{margin-top:13px;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 16px;font-size:12.5px;color:var(--parch-d)}
.wof-ctl-more span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.wof-root .wof-ctl-more kbd{height:20px;min-width:22px;padding:0 5px;font-size:11px;border-bottom-width:2px}
.wof-note{margin:12px 0 0;text-align:center;font-family:var(--serif);font-style:italic;font-size:12px;letter-spacing:.05em;color:var(--parch-d)}
.wof-note b{font-style:normal;color:var(--parch)}

.wof-h2,.wof-death-title{margin:0;text-align:center;font-family:var(--serif);font-weight:900;text-transform:uppercase;line-height:1.05;color:#efe3c6;
  text-shadow:0 3px 0 #120806,0 0 26px rgba(190,30,20,.7),0 0 2px #000}
.wof-h2{font-size:clamp(30px,5.4vw,58px);letter-spacing:.2em;padding-left:.2em}
.wof-death-title{font-size:clamp(28px,4.9vw,56px);letter-spacing:.05em;white-space:nowrap}
.wof-death-card{align-items:center;padding:30px 24px 28px}
.wof-death-stats{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:22px 0 24px}
.wof-death-stats div{text-align:center;padding:10px 6px;border:1px solid var(--leather);border-radius:4px;background:rgba(0,0,0,.28)}
.wof-death-stats span{display:block;font-family:var(--serif);font-size:11px;letter-spacing:.24em;color:var(--brass)}
.wof-death-stats b{display:block;margin-top:4px;font-size:clamp(20px,3.2vw,28px);font-weight:800;font-variant-numeric:tabular-nums}
.wof-pause-card{gap:0}
.wof-pause-card .wof-btn{margin:20px 0 22px}
.wof-death-btns{margin-top:22px}
.wof-death-btns .wof-btn{min-width:200px}
.wof-death-btns .wof-btn[hidden]{display:none}

/* training results */
.wof-result-card{width:min(640px,100%);align-items:center;padding:24px 24px 26px}
.wof-result-h{margin:0;text-align:center;font-family:var(--serif);font-weight:900;font-size:clamp(24px,4.2vw,44px);letter-spacing:.16em;padding-left:.16em;
  text-transform:uppercase;line-height:1.05;color:var(--parch);text-shadow:0 3px 0 #120c06,0 0 26px rgba(201,162,90,.55),0 0 2px #000}
.wof-badge{display:none;margin-top:12px;padding:5px 16px 4px;font-family:var(--serif);font-weight:900;font-size:13px;letter-spacing:.3em;padding-left:calc(16px + .3em);
  color:#1b1206;background:linear-gradient(180deg,#ffeaa8,#e0b04a 55%,#a3761f);border-radius:3px;box-shadow:0 0 18px rgba(255,200,80,.6),0 0 0 1px #3a2a10;
  animation:wof-badge .8s ease-in-out infinite alternate}
.wof-result-card.rec .wof-badge{display:inline-block}
@keyframes wof-badge{from{transform:scale(1);filter:brightness(1)}to{transform:scale(1.07);filter:brightness(1.18)}}
.wof-result-time{margin-top:10px;font-weight:900;font-style:italic;font-size:clamp(48px,9vw,92px);line-height:1;letter-spacing:-.01em;
  font-variant-numeric:tabular-nums;color:#fff8e8;text-shadow:0 3px 0 rgba(0,0,0,.6),0 0 22px rgba(201,162,90,.35)}
.wof-result-card .wof-death-stats{margin:20px 0 4px}
.wof-result-card .wof-death-stats b small{font-size:.5em;font-weight:700;letter-spacing:.1em;color:var(--parch-d);margin-left:4px}

@media (max-width:1240px){
  .wof-hint{bottom:178px;max-width:max(260px,calc(100vw - 600px))}
}
@media (min-width:701px){
  .wof-root.tr-on .wof-obj{max-width:calc(100vw - 464px)}
}
@media (max-height:660px){
  .wof-screen-in{gap:12px;padding:14px 16px}
  .wof-title{font-size:clamp(28px,9vh,60px)}
  .wof-subtitle{margin-top:6px}
  .wof-divider{display:none}
  .wof-grp ul{display:none}
  .wof-grp-k{height:auto}
}
.wof-subtitle{text-wrap:balance}
@media (max-width:700px){
  .wof-obj{top:64px;max-width:calc(100vw - 20px);font-size:11px;letter-spacing:.12em;padding:5px 12px;line-height:1.35;white-space:normal;text-overflow:clip}
  .wof-toast{top:126px;font-size:14px;max-width:calc(100vw - 20px)}
  .wof-ctl{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .wof-hp{width:min(180px,44vw)}
  .wof-tl{gap:8px}
  .wof-crest{width:38px;height:42px}
  .wof-tr{right:10px;top:10px;min-width:0;padding:4px 10px}
  .wof-tr-row b{font-size:18px}
  .wof-hint{bottom:222px;max-width:calc(100vw - 20px);font-size:13px}
  .wof-blc{left:10px;bottom:10px;max-width:none;width:calc(100vw - 20px)}
  .wof-bl{width:100%;padding:8px 10px;gap:7px}
  .wof-row2 > .wof-label{width:auto;min-width:62px;letter-spacing:.14em}
  .wof-canisters{gap:4px}
  .wof-canister{min-width:0}
  .wof-blade{min-width:40px}
  .wof-spare{min-width:36px}
  .wof-br{right:10px;bottom:86px;min-width:0;padding:6px 12px}
  .wof-speed{font-size:40px}
  .wof-stat span{font-size:10px;letter-spacing:.12em}
  .wof-btn{min-width:min(250px,80vw)}
  .wof-death-stats{gap:8px}
}
`;

const TEMPLATE = `
<div class="wof-game">
  <div class="wof-tl" data-low="0">
    <svg class="wof-crest" viewBox="0 0 48 52" aria-hidden="true">
      <path d="M24 1.5 L45 8.5 V25 C45 38 36 46.5 24 50.5 C12 46.5 3 38 3 25 V8.5 Z" fill="#26321d" stroke="#c9a25a" stroke-width="2"/>
      <path d="M24 6 L41 11.5 V25 C41 35 34 42 24 46 C14 42 7 35 7 25 V11.5 Z" fill="none" stroke="#c9a25a" stroke-width="0.8" opacity=".55"/>
      <path d="M24.5 42 C25.5 33 31 23 41 14.5 C40.2 19.5 39.6 22.4 38.6 24.6 C41.2 24.2 43 24.4 44.6 25.4 C42.6 27.8 40.5 30.2 38.2 32.2 C39.4 32.4 41 32.8 42.4 33.8 C39.6 36.8 35.5 39.6 30 41.2 Z" fill="#f4f0e2" stroke="#1a140c" stroke-width="0.6" stroke-linejoin="round"/>
      <path d="M23.5 42 C22.5 33 17 23 7 14.5 C7.8 19.5 8.4 22.4 9.4 24.6 C6.8 24.2 5 24.4 3.4 25.4 C5.4 27.8 7.5 30.2 9.8 32.2 C8.6 32.4 7 32.8 5.6 33.8 C8.4 36.8 12.5 39.6 18 41.2 Z" fill="#2f6fb2" stroke="#0d1a2c" stroke-width="0.6" stroke-linejoin="round"/>
      <circle cx="24" cy="42" r="1.8" fill="#c9a25a"/>
    </svg>
    <span class="wof-label">HP</span>
    <div class="wof-bar wof-hp"><div class="wof-bar-fill"></div></div>
  </div>

  <div class="wof-vig"></div>
  <div class="wof-obj wof-panel"></div>
  <div class="wof-toast info"></div>
  <div class="wof-feed"></div>
  <div class="wof-tr wof-panel">
    <div class="wof-tr-row" data-r="timer" hidden><span>TIME</span><b>00:00.0</b></div>
    <div class="wof-tr-row" data-r="targets" hidden><span>DUMMIES LEFT</span><b class="sm">0 / 0</b></div>
  </div>

  <div class="wof-blc">
  <div class="wof-cc">
    <span class="k"><kbd>&larr;</kbd><kbd>&rarr;</kbd></span><span class="t"><b>turn</b> &middot; swing</span>
    <span class="k"><kbd>&uarr;</kbd><kbd>&darr;</kbd></span><span class="t"><b>run</b> / pump &middot; <b>brake</b> / slacken</span>
    <span class="k"><kbd class="z">Z</kbd><kbd class="x">X</kbd></span><span class="t"><b>hold</b>: rope left / right &middot; both = zip</span>
    <span class="k"><kbd class="w">Shift</kbd></span><span class="t"><b>gas</b> &middot; tap on the ground = jump</span>
    <span class="k"><kbd class="w">Space</kbd></span><span class="t"><b>cut</b> &middot; hold flying fast = spin</span>
    <span class="k"><kbd>H</kbd></span><span class="t">hide this card</span>
  </div>
  <div class="wof-bl wof-panel">
    <div class="wof-row2">
      <span class="wof-label">GAS</span>
      <div class="wof-canisters">
        <div class="wof-canister"><div class="wof-bar-fill wof-canister-fill g"></div></div>
        <div class="wof-canister"><div class="wof-bar-fill wof-canister-fill g"></div></div>
      </div>
    </div>
    <div class="wof-row2">
      <span class="wof-label">BLADES</span>
      <div class="wof-bar wof-blade"><div class="wof-bar-fill"></div></div>
      <span class="wof-spare"><i>&#x25AE;</i>&times;<b>0</b></span>
    </div>
  </div>
  </div>

  <div class="wof-cross" data-valid="1" data-lock="0">
    <div class="wof-ring"></div>
    <div class="wof-dot"></div>
    <svg class="wof-x" viewBox="-30 -30 60 60" aria-hidden="true">
      <path d="M-7 -7 L7 7 M7 -7 L-7 7" stroke="#d2402e" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>
    </svg>
    <svg class="wof-lock" viewBox="-30 -30 60 60" aria-hidden="true">
      <path d="M-18 -10 V-18 H-10 M18 -10 V-18 H10 M-18 10 V18 H-10 M18 10 V18 H10" fill="none" stroke="#ff4a3a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="wof-dist"></div>
    <div class="wof-hook" data-side="0" data-state="idle">
      <svg viewBox="0 0 16 20"><path d="M12 2 L4 10 L12 18"/></svg><span>Z</span>
    </div>
    <div class="wof-hook" data-side="1" data-state="idle">
      <svg viewBox="0 0 16 20"><path d="M4 2 L12 10 L4 18"/></svg><span>X</span>
    </div>
  </div>
  <div class="wof-napes"></div>
  <div class="wof-threats"></div>
  <div class="wof-tgts">
    <div class="wof-tgt" data-side="0" data-att="0"><i></i><b>Z</b></div>
    <div class="wof-tgt" data-side="1" data-att="0"><i></i><b>X</b></div>
  </div>
  <div class="wof-hint"><span class="ks"></span><span class="tx"></span></div>
  <div class="wof-grab">
    <div class="wof-grab-t"><span>MASH</span><kbd>SPACE</kbd></div>
    <div class="wof-bar wof-grab-bar"><div class="wof-bar-fill"></div></div>
    <div class="wof-grab-s">CUT YOURSELF FREE</div>
  </div>

  <div class="wof-br wof-panel">
    <div class="wof-combo"></div>
    <div class="wof-speed-row"><span class="wof-speed">0</span><span class="wof-unit">KM/H</span></div>
    <div class="wof-stat"><span>KILLS</span><b data-k="kills">0</b></div>
    <div class="wof-stat"><span>SCORE</span><b data-k="score">0</b></div>
  </div>

  <div class="wof-dmgs"></div>
  <div class="wof-big"><span></span><i></i></div>
</div>

<div class="wof-screen wof-menu">
  <div class="wof-screen-in">
    <h1 class="wof-title">WINGS OF FREEDOM</h1>
    <div class="wof-subtitle">An unofficial Attack on Titan fan game &middot; not affiliated with the creators or publishers</div>
    <div class="wof-divider"></div>
    <div class="wof-menu-btns">
      <button class="wof-btn" data-mode="expedition"><b>EXPEDITION</b><small>Fight the titans</small></button>
      <button class="wof-btn" data-mode="training"><b>TRAINING</b><small>Training Grounds: cut the dummies against the clock</small></button>
      <button class="wof-btn" data-mode="free"><b>FREE FLIGHT</b><small>No titans, infinite gas</small></button>
    </div>
    <div class="wof-card wof-panel">
      <div class="wof-card-title">Controls &middot; keyboard only</div>
      <div data-keys></div>
    </div>
  </div>
</div>

<div class="wof-screen wof-pause">
  <div class="wof-screen-in">
    <div class="wof-card wof-panel wof-pause-card">
      <h2 class="wof-h2">Paused</h2>
      <button class="wof-btn wof-resume"><b>RESUME</b></button>
      <div class="wof-card-title">Controls</div>
      <div data-keys></div>
    </div>
  </div>
</div>

<div class="wof-screen wof-result">
  <div class="wof-screen-in">
    <div class="wof-card wof-panel wof-result-card">
      <div class="wof-card-title">Training Grounds</div>
      <h1 class="wof-result-h">COURSE CLEARED</h1>
      <div class="wof-badge">NEW RECORD</div>
      <div class="wof-result-time">00:00.0</div>
      <div class="wof-death-stats">
        <div><span>BEST</span><b data-r="best">--:--.-</b></div>
        <div><span>DUMMIES</span><b data-r="cuts">0 / 0</b></div>
        <div><span>AVG CUT</span><b data-r="avg">0<small>KM/H</small></b></div>
      </div>
      <div class="wof-menu-btns wof-death-btns">
        <button class="wof-btn" data-act="again"><b>RUN AGAIN</b></button>
        <button class="wof-btn alt" data-act="menu"><b>MENU</b></button>
      </div>
    </div>
  </div>
</div>

<div class="wof-screen wof-death">
  <div class="wof-screen-in">
    <div class="wof-card wof-panel wof-death-card">
      <h1 class="wof-death-title">YOU WERE EATEN</h1>
      <div class="wof-death-stats">
        <div><span>KILLS</span><b data-d="kills">0</b></div>
        <div><span>SCORE</span><b data-d="score">0</b></div>
        <div><span>TIME</span><b data-d="time">0:00</b></div>
      </div>
      <div class="wof-menu-btns wof-death-btns">
        <button class="wof-btn wof-retry"><b>RETURN TO THE WALL</b></button>
        <button class="wof-btn alt wof-death-menu" hidden><b>MENU</b></button>
      </div>
    </div>
  </div>
</div>
`;

// Control reference shared by the title screen and the pause screen: four groups, read left to right.
const CONTROL_ROWS = `
<div class="wof-ctl">
  <div class="wof-grp">
    <div class="wof-grp-h">MOVE</div>
    <div class="wof-grp-k wof-arrows"><kbd>&uarr;</kbd><kbd>&larr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd></div>
    <ul><li><b>&larr; &rarr;</b> turn &middot; swing</li><li><b>&uarr;</b> run &middot; pump the swing</li><li><b>&darr;</b> brake &middot; slacken</li></ul>
  </div>
  <div class="wof-grp">
    <div class="wof-grp-h">ROPES</div>
    <div class="wof-grp-k"><kbd class="z">Z</kbd><kbd class="x">X</kbd></div>
    <ul><li>hold <b>Z</b> left &middot; <b>X</b> right</li><li>sticks at the marker</li><li><b>Z + X</b> zip forward</li></ul>
  </div>
  <div class="wof-grp">
    <div class="wof-grp-h">GAS</div>
    <div class="wof-grp-k"><kbd class="w">Shift</kbd></div>
    <ul><li><b>boost</b> &middot; reel faster</li><li>tap on the ground: <b>jump</b></li></ul>
  </div>
  <div class="wof-grp">
    <div class="wof-grp-h">CUT</div>
    <div class="wof-grp-k"><kbd class="sp">Space</kbd></div>
    <ul><li><b>slash</b> the nape</li><li>hold flying fast: <b>spin</b></li></ul>
  </div>
</div>
<div class="wof-ctl-more">
  <span><kbd>Esc</kbd><kbd>P</kbd> pause</span><span><kbd>F</kbd> whistle for horse</span><span><kbd>M</kbd> mute</span><span><kbd>H</kbd> controls card</span>
  <span><kbd>R</kbd> blades (auto when dull)</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> = arrows</span>
</div>
<p class="wof-note"><b>Mouse optional:</b> click the game to look with the mouse</p>`;

// Key names for hint keycaps: accepts 'Z', 'Left', 'ArrowLeft', 'Space', 'Shift', ...
const KEY_LABEL = {
  left: '←', arrowleft: '←', right: '→', arrowright: '→', up: '↑', arrowup: '↑',
  down: '↓', arrowdown: '↓', space: 'Space', ' ': 'Space', shift: 'Shift', shiftleft: 'Shift',
  escape: 'Esc', esc: 'Esc', enter: 'Enter',
};
const THREAT_SVG = '<svg viewBox="-11 -9 22 18" aria-hidden="true"><path d="M-10 7 L0 -7 L10 7 L0 2.5 Z"/></svg>';

let _cssInjected = false;
function injectStyles() {
  if (_cssInjected) return;
  _cssInjected = true;
  try {
    if (!document.getElementById('wof-hud-fonts')) {
      const link = document.createElement('link');
      link.id = 'wof-hud-fonts';
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    const style = document.createElement('style');
    style.id = 'wof-hud-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  } catch (e) { /* no document head: nothing to style */ }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Number to a 0..1 fraction, quantised to 1/500 so tiny drifts do not touch the DOM. */
function frac(v, fallback) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.round(clamp(x, 0, 1) * 500) / 500;
}
function fmtTime(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return typeof t === 'string' ? t : '--:--';
  const m = Math.floor(n / 60), s = Math.floor(n % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
/** Seconds as tenths (integer), or -1 when not a number. */
function tenths(t) {
  const n = Number(t);
  return t === null || t === undefined || !Number.isFinite(n) ? -1 : Math.floor(Math.max(0, n) * 10 + 1e-6);
}
/** Tenths of a second to mm:ss.t (e.g. 1234 -> "02:03.4"); -1 -> "--:--.-". */
function fmtClock(tt) {
  if (!(tt >= 0)) return '--:--.-';
  const m = Math.floor(tt / 600), s = Math.floor(tt / 10) % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (tt % 10);
}
function keyLabel(k) {
  const s = String(k);
  return KEY_LABEL[s.toLowerCase()] || (s.length === 1 ? s.toUpperCase() : s);
}
function kbdFor(k) {
  const label = keyLabel(k);
  const n = document.createElement('kbd');
  n.textContent = label;
  if (label === 'Z') n.className = 'z';
  else if (label === 'X') n.className = 'x';
  else if (label === 'Space' || label === 'Shift') n.className = 'w';
  return n;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this._c = {};                      // last written values, so update() can skip unchanged ones
    this._t = { toast: 0, big: 0, hint: 0 }; // message + hint timers
    this._napes = [];                  // pool of nape marker elements
    this._threats = [];                // pool of threat chevron elements
    this._onStart = null;
    this._onResume = null;
    this._onRetry = null;
    this._onMenu = null;               // death screen MENU
    this._onAgain = null;              // training result RUN AGAIN
    this._onResultMenu = null;         // training result MENU
    this._hintNext = null;             // hint waiting for the fade-out of the previous one
    this._vw = typeof innerWidth === 'number' ? innerWidth : 1280;
    this._vh = typeof innerHeight === 'number' ? innerHeight : 720;

    injectStyles();
    const root = document.createElement('div');
    root.className = 'wof-root';
    root.innerHTML = TEMPLATE;
    root.querySelectorAll('[data-keys]').forEach((n) => { n.innerHTML = CONTROL_ROWS; });
    document.body.appendChild(root);
    this.root = root;

    const q = (sel) => root.querySelector(sel);
    const all = (sel) => Array.from(root.querySelectorAll(sel));
    this.el = {
      tl: q('.wof-tl'),
      hpFill: q('.wof-hp .wof-bar-fill'),
      gasWrap: q('.wof-canisters'),
      gasFill: all('.wof-canister-fill'),
      blade: q('.wof-blade'),
      bladeFill: q('.wof-blade .wof-bar-fill'),
      spare: q('.wof-spare b'),
      cross: q('.wof-cross'),
      dist: q('.wof-dist'),
      hooks: all('.wof-hook'),
      napeLayer: q('.wof-napes'),
      speed: q('.wof-speed'),
      combo: q('.wof-combo'),
      kills: q('[data-k="kills"]'),
      score: q('[data-k="score"]'),
      obj: q('.wof-obj'),
      toast: q('.wof-toast'), feed: q('.wof-feed'),
      big: q('.wof-big'),
      dmgs: q('.wof-dmgs'),
      menu: q('.wof-menu'),
      pause: q('.wof-pause'),
      death: q('.wof-death'),
      deathTitle: q('.wof-death-title'),
      deathKills: q('[data-d="kills"]'),
      deathScore: q('[data-d="score"]'),
      deathTime: q('[data-d="time"]'),
      deathMenu: q('.wof-death-menu'),
      result: q('.wof-result'),
      resultCard: q('.wof-result-card'),
      resultTitle: q('.wof-result-h'),
      resultTime: q('.wof-result-time'),
      resultBest: q('[data-r="best"]'),
      resultCuts: q('[data-r="cuts"]'),
      resultAvg: q('[data-r="avg"]'),
      tr: q('.wof-tr'),
      timerRow: q('[data-r="timer"]'),
      timer: q('[data-r="timer"] b'),
      targetsRow: q('[data-r="targets"]'),
      targets: q('[data-r="targets"] b'),
      cc: q('.wof-cc'),
      hint: q('.wof-hint'),
      hintKeys: q('.wof-hint .ks'),
      hintText: q('.wof-hint .tx'),
      grabFill: q('.wof-grab-bar .wof-bar-fill'),
      tgts: all('.wof-tgt'),
      threatLayer: q('.wof-threats'),
    };

    // Buttons blur after a click so a later Space/Enter cannot re-click them.
    const press = (node, fn) => node.addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
    this.el.menu.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-mode]');
      if (!b) return;
      b.blur();
      const mode = b.getAttribute('data-mode');
      this.hideMenu();
      if (this._onStart) this._onStart(mode);
    });
    press(q('.wof-resume'), () => { this.hidePause(); if (this._onResume) this._onResume(); });
    press(q('.wof-retry'), () => { this.hideDeath(); if (this._onRetry) this._onRetry(); });
    press(this.el.deathMenu, () => { this.hideDeath(); if (this._onMenu) this._onMenu(); });
    press(q('[data-act="again"]'), () => { this.hideTrainingResult(); if (this._onAgain) this._onAgain(); });
    press(q('[data-act="menu"]'), () => { this.hideTrainingResult(); if (this._onResultMenu) this._onResultMenu(); });

    // Keyboard-only play: on a full screen, arrows move a highlight between its buttons and Enter presses it.
    // (Space is never used here: it is the cut key and may still be mashed when a screen appears.)
    this._sel = 0;
    try {
      addEventListener('keydown', (e) => this._screenKey(e));
      addEventListener('resize', () => { this._vw = innerWidth; this._vh = innerHeight; });
    } catch (e) { /* no window */ }
  }

  /** Per-frame HUD refresh. s: see ARCHITECTURE.md. Only changed values touch the DOM. */
  update(s) {
    if (!s) return;
    const c = this._c, el = this.el;

    const hp = frac(s.hp, 1);
    if (c.hp !== hp) {
      c.hp = hp;
      el.hpFill.style.transform = 'scaleX(' + hp + ')';
      el.tl.setAttribute('data-low', hp < 0.3 ? '1' : '0');
    }

    const gas = frac(s.gas, 0);
    if (c.gas !== gas) {
      c.gas = gas;
      // Two canisters: the first covers the upper half of the tank, the second the lower half.
      el.gasFill[0].style.transform = 'scaleX(' + clamp(gas * 2, 0, 1) + ')';
      el.gasFill[1].style.transform = 'scaleX(' + clamp(gas * 2 - 1, 0, 1) + ')';
      const level = gas < 0.2 ? 'r' : gas < 0.5 ? 'a' : 'g';
      if (c.gasLevel !== level) {
        c.gasLevel = level;
        for (const f of el.gasFill) f.className = 'wof-bar-fill wof-canister-fill ' + level;
      }
      el.gasWrap.classList.toggle('pulse', gas < 0.2);
    }

    const blade = frac(s.blade, 1);
    if (c.blade !== blade) {
      c.blade = blade;
      el.bladeFill.style.transform = 'scaleX(' + blade + ')';
      el.blade.classList.toggle('low', blade < 0.25);
    }

    const spare = Math.max(0, Math.floor(Number(s.bladesSpare) || 0));
    if (c.spare !== spare) { c.spare = spare; el.spare.textContent = spare; }

    const kmh = Math.round(Math.max(0, Number(s.speed) || 0) * 3.6);
    if (c.kmh !== kmh) { c.kmh = kmh; el.speed.textContent = kmh; }

    const kills = Math.max(0, Math.floor(Number(s.kills) || 0));
    if (c.kills !== kills) { c.kills = kills; el.kills.textContent = kills; }

    const score = Math.max(0, Math.round(Number(s.score) || 0));
    if (c.score !== score) { c.score = score; el.score.textContent = score.toLocaleString('en-US'); }

    const combo = Math.max(0, Math.floor(Number(s.combo) || 0));
    if (c.combo !== combo) {
      const prev = c.combo || 0;
      c.combo = combo;
      el.combo.textContent = combo > 1 ? '×' + combo + ' COMBO' : '';
      el.combo.classList.toggle('on', combo > 1);
      if (combo > prev && combo > 1) this._pop(el.combo);
    }

    const obj = s.objective ? String(s.objective) : '';
    if (c.obj !== obj) {
      c.obj = obj;
      el.obj.textContent = obj;
      el.obj.classList.toggle('on', obj.length > 0);
    }

    const hooks = s.hooks || [];
    for (let i = 0; i < 2; i++) {
      const st = (hooks[i] && hooks[i].state) || 'idle';
      if (c['hook' + i] !== st) {
        c['hook' + i] = st;
        el.hooks[i].setAttribute('data-state', st);
      }
    }

    const aim = s.aim || {};
    const valid = !!aim.valid;
    const lock = !!aim.lockTitan;
    const aimKey = (valid ? 1 : 0) + (lock ? 2 : 0);
    if (c.aim !== aimKey) {
      c.aim = aimKey;
      el.cross.setAttribute('data-valid', valid ? '1' : '0');
      el.cross.setAttribute('data-lock', lock ? '1' : '0');
    }
    const dist = valid ? Math.round(Math.max(0, Number(aim.distance) || 0)) : -1;
    if (c.dist !== dist) {
      c.dist = dist;
      el.dist.textContent = dist >= 0 ? dist + ' m' : '';
    }

    const marks = s.napeMarkers || [];
    let used = 0;
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (!m || !m.visible) continue;
      const node = this._nape(used++);
      const x = Math.round(m.x), y = Math.round(m.y);
      if (node._x !== x || node._y !== y) {
        node._x = x;
        node._y = y;
        node.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 5) + 'px) rotate(45deg)';
      }
      if (!node._on) { node._on = true; node.style.display = 'block'; }
    }
    for (let i = used; i < this._napes.length; i++) {
      const node = this._napes[i];
      if (node._on) { node._on = false; node.style.display = 'none'; }
    }

    this._updateHookTargets(s.hookTargets);
    this._updateThreats(s.threats);
    this._updateHint(s.hint);

    // training clock + dummies (top-right)
    const tt = tenths(s.timer);
    if (c.timer !== tt) {
      c.timer = tt;
      el.timer.textContent = fmtClock(tt);
      el.timerRow.hidden = tt < 0;
    }
    const tg = s.targets;
    const tgKey = tg && Number.isFinite(Number(tg.left)) ? Math.max(0, Math.round(Number(tg.left))) + ' / '
      + Math.max(0, Math.round(Number(tg.total) || 0)) : '';
    if (c.targets !== tgKey) {
      c.targets = tgKey;
      el.targets.textContent = tgKey;
      el.targetsRow.hidden = !tgKey;
    }
    const trOn = tt >= 0 || !!tgKey;
    if (c.trOn !== trOn) { c.trOn = trOn; el.tr.classList.toggle('on', trOn); this.root.classList.toggle('tr-on', trOn); }

    const cc = !!s.controlsCard;
    if (c.cc !== cc) { c.cc = cc; el.cc.classList.toggle('on', cc); }

    // grabbed: MASH SPACE + struggle bar
    const grabbed = !!s.grabbed;
    if (c.grabbed !== grabbed) { c.grabbed = grabbed; this.root.classList.toggle('grabbed', grabbed); }
    const struggle = grabbed ? frac(s.struggle, 0) : 0;
    if (c.struggle !== struggle) { c.struggle = struggle; el.grabFill.style.transform = 'scaleX(' + struggle + ')'; }
  }

  /** Training Grounds results. r: { time, best (s), cuts, total, avgSpeed (km/h), newBest }. */
  showTrainingResult(r, onRetry, onMenu) {
    const st = r || {};
    const el = this.el;
    this._onAgain = onRetry || null;
    this._onResultMenu = onMenu || null;
    const cuts = Math.max(0, Math.round(Number(st.cuts) || 0));
    const total = Math.max(0, Math.round(Number(st.total) || 0));
    el.resultTitle.textContent = total > 0 && cuts < total ? 'TIME’S UP' : 'COURSE CLEARED';
    el.resultTime.textContent = fmtClock(tenths(st.time));
    el.resultBest.textContent = fmtClock(tenths(st.best));
    el.resultCuts.textContent = total > 0 ? cuts + ' / ' + total : String(cuts);
    el.resultAvg.firstChild.textContent = String(Math.max(0, Math.round(Number(st.avgSpeed) || 0)));
    el.resultCard.classList.toggle('rec', !!st.newBest);
    el.pause.classList.remove('on');
    el.death.classList.remove('on');
    el.result.classList.add('on');
    this._sel = 0;
    this._syncHud();
  }

  hideTrainingResult() {
    this.el.result.classList.remove('on');
    this._syncHud();
  }

  /** Big bold italic damage number that pops at screen (x, y) px, then floats up and fades (~1.2 s). */
  damageNumber(value, screenX, screenY, kill) {
    const layer = this.el.dmgs;
    while (layer.childElementCount > 40) layer.firstElementChild.remove();
    const d = document.createElement('div');
    d.className = kill ? 'wof-dmg kill' : 'wof-dmg';
    d.textContent = String(Math.round(Number(value) || 0));
    d.style.left = Math.round(screenX) + 'px';
    d.style.top = Math.round(screenY) + 'px';
    layer.appendChild(d);
    setTimeout(() => d.remove(), 1300);
  }

  /** Right-hand feed line: squad radio ('radio'), kills ('kill'), trouble ('warn'). `who` is shown bold. */
  feed(text, kind = 'info', who = '') {
    const box = this.el.feed;
    if (!box) return;
    const d = document.createElement('div');
    d.className = kind;
    if (who) { const b = document.createElement('b'); b.textContent = who + ': '; d.appendChild(b); }
    d.appendChild(document.createTextNode(String(text)));
    box.appendChild(d);
    while (box.children.length > 5) box.firstChild.remove();
    requestAnimationFrame(() => d.classList.add('on'));
    setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 300); }, kind === 'warn' ? 6000 : 4500);
  }

  /** Centre-top toast (info / warn), or a huge cinematic line in the middle of the screen (big). */
  message(text, seconds = 2.5, style = 'info') {
    const dur = Math.max(0.3, Number(seconds) || 2.5) * 1000;
    if (style === 'big') {
      const el = this.el.big;
      el.firstElementChild.textContent = String(text);
      el.classList.remove('on');
      cancelAnimationFrame(this._bigRaf);
      this._bigRaf = requestAnimationFrame(() => { this._bigRaf = requestAnimationFrame(() => el.classList.add('on')); });   // restart the entrance without forcing a layout
      clearTimeout(this._t.big);
      this._t.big = setTimeout(() => el.classList.remove('on'), dur);
      return;
    }
    const el = this.el.toast;
    el.textContent = String(text);
    el.classList.remove('on', 'info', 'warn');
    el.classList.add(style === 'warn' ? 'warn' : 'info');
    cancelAnimationFrame(this._toastRaf);
    this._toastRaf = requestAnimationFrame(() => { this._toastRaf = requestAnimationFrame(() => el.classList.add('on')); });
    clearTimeout(this._t.toast);
    this._t.toast = setTimeout(() => el.classList.remove('on'), dur);
  }

  /** Title screen. onStart(mode) is called with 'expedition', 'training' or 'free'. */
  showMenu(onStart) {
    this._onStart = onStart || null;
    this.el.menu.classList.add('on');
    this._sel = 0;
    this._syncHud();
  }

  hideMenu() {
    this.el.menu.classList.remove('on');
    this._syncHud();
  }

  /** Death screen. stats: { cause, kills, score, time (seconds) }. onRetry() after "RETURN TO THE WALL";
   *  onMenu() after MENU (the button is only shown when onMenu is given). */
  showDeath(stats, onRetry, onMenu) {
    const st = stats || {};
    this._onRetry = onRetry || null;
    this._onMenu = typeof onMenu === 'function' ? onMenu : null;
    this.el.deathMenu.hidden = !this._onMenu;
    this._sel = 0;
    this.el.deathTitle.textContent = st.cause ? String(st.cause) : 'YOU WERE EATEN';
    this.el.deathKills.textContent = Math.max(0, Math.floor(Number(st.kills) || 0));
    this.el.deathScore.textContent = Math.max(0, Math.round(Number(st.score) || 0)).toLocaleString('en-US');
    this.el.deathTime.textContent = fmtTime(st.time);
    this.el.pause.classList.remove('on');
    this.el.death.classList.add('on');
    this._syncHud();
  }

  hideDeath() {
    this.el.death.classList.remove('on');
    this._syncHud();
  }

  /** Pause screen. onResume() after the RESUME button. */
  showPause(onResume) {
    this._onResume = onResume || null;
    this.el.pause.classList.add('on');
    this._sel = 0;
    this._syncHud();
  }

  hidePause() {
    this.el.pause.classList.remove('on');
    this._syncHud();
  }

  // ---- internals ----

  /** The in-game HUD is hidden behind the title, pause and death screens. */
  _syncHud() {
    const off = !!this._screen();
    this.root.classList.toggle('hud-off', off);
    this._markSel();
  }

  /** The full screen currently shown (topmost first), or null. */
  _screen() {
    const el = this.el;
    for (const n of [el.death, el.result, el.pause, el.menu]) if (n.classList.contains('on')) return n;
    return null;
  }

  _buttons(screen) {
    return Array.from(screen.querySelectorAll('.wof-btn')).filter((b) => !b.hidden);
  }

  _markSel() {
    const screen = this._screen();
    for (const b of this.root.querySelectorAll('.wof-btn.sel')) b.classList.remove('sel');
    if (!screen) return;
    const btns = this._buttons(screen);
    if (!btns.length) return;
    this._sel = ((this._sel % btns.length) + btns.length) % btns.length;
    btns[this._sel].classList.add('sel');
  }

  /** Arrow keys move the highlighted button on the shown screen; Enter presses it. */
  _screenKey(e) {
    const screen = this._screen();
    if (!screen || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.code || e.key;
    let d = 0;
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'KeyA' || k === 'KeyW') d = -1;
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'KeyD' || k === 'KeyS') d = 1;
    if (d) {
      if (e.repeat) return;
      this._sel += d;
      this._markSel();
      e.preventDefault();
      return;
    }
    if ((k === 'Enter' || k === 'NumpadEnter') && !e.repeat) {
      const btns = this._buttons(screen);
      const b = btns[this._sel] || btns[0];
      if (b) { e.preventDefault(); b.click(); }
    }
  }

  /** Rope target diamonds: index 0 = Z (left, cyan), 1 = X (right, amber). Hidden unless visible and valid (or attached). */
  _updateHookTargets(list) {
    const c = this._c;
    for (let i = 0; i < 2; i++) {
      const node = this.el.tgts[i];
      const m = list && list[i];
      const x = m ? Math.round(Number(m.x)) : NaN, y = m ? Math.round(Number(m.y)) : NaN;
      const att = !!(m && m.attached);
      const on = !!(m && m.visible && (m.valid || att)) && Number.isFinite(x) && Number.isFinite(y);
      if (c['tgtOn' + i] !== on) { c['tgtOn' + i] = on; node.style.display = on ? 'block' : 'none'; }
      if (!on) continue;
      if (node._x !== x || node._y !== y) {
        node._x = x; node._y = y;
        node.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      }
      if (c['tgtAtt' + i] !== att) { c['tgtAtt' + i] = att; node.setAttribute('data-att', att ? '1' : '0'); }
    }
  }

  /** Off-screen titans: red chevrons on a ring around the crosshair, or at the given (clamped) screen point. */
  _updateThreats(list) {
    let used = 0;
    if (Array.isArray(list) && list.length) {
      const cx = this._vw / 2, cy = this._vh / 2;
      const ring = clamp(Math.min(this._vw, this._vh) * 0.2, 60, 150);
      for (let i = 0; i < list.length && used < 16; i++) {
        const t = list[i];
        if (!t) continue;
        const a = Number(t.angle) || 0;
        let x = Number(t.x), y = Number(t.y);
        const M = 18;
        if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= this._vw && y <= this._vh) {
          x = clamp(x, M, this._vw - M); y = clamp(y, M, this._vh - M);
        } else { x = cx + ring * Math.sin(a); y = cy - ring * Math.cos(a); }
        x = Math.round(x); y = Math.round(y);
        const deg = Math.round(a * 57.29578 / 2) * 2;
        const node = this._threat(used++);
        if (node._x !== x || node._y !== y || node._a !== deg) {
          node._x = x; node._y = y; node._a = deg;
          node.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + deg + 'deg)';
        }
        const danger = !!t.danger;
        if (node._d !== danger) { node._d = danger; node.classList.toggle('danger', danger); }
        if (!node._on) { node._on = true; node.style.display = 'block'; }
      }
    }
    for (let i = used; i < this._threats.length; i++) {
      const node = this._threats[i];
      if (node._on) { node._on = false; node.style.display = 'none'; }
    }
  }

  _threat(i) {
    while (this._threats.length <= i) {
      const node = document.createElement('div');
      node.className = 'wof-thr';
      node.style.display = 'none';
      node.innerHTML = THREAT_SVG;
      this.el.threatLayer.appendChild(node);
      this._threats.push(node);
    }
    return this._threats[i];
  }

  /** Tutorial prompt bottom-centre: { keys: ['Z','X'], text }. A change fades the old one out, then the new one in. */
  _updateHint(h) {
    if (h === this._hintObj && (!h || h.text === this._hintTxt)) return;
    this._hintObj = h; this._hintTxt = h && h.text;
    const c = this._c;
    const keys = h && Array.isArray(h.keys) ? h.keys : [];
    const text = h && h.text ? String(h.text) : '';
    const key = h && (text || keys.length) ? keys.join('\u0001') + '\u0002' + text : '';
    if (c.hint === key) return;
    c.hint = key;
    const el = this.el.hint;
    this._hintNext = key ? { keys, text } : null;
    clearTimeout(this._t.hint);
    if (el.classList.contains('on')) {
      el.classList.remove('on');
      this._t.hint = setTimeout(() => this._showHint(), 230);
    } else {
      this._showHint();
    }
  }

  _showHint() {
    const h = this._hintNext;
    if (!h) return;
    const el = this.el;
    el.hintKeys.textContent = '';
    for (const k of h.keys) el.hintKeys.appendChild(kbdFor(k));
    el.hintKeys.style.display = h.keys.length ? '' : 'none';
    el.hintText.textContent = h.text;
    requestAnimationFrame(() => requestAnimationFrame(() => el.hint.classList.add('on')));   // fade in from hidden, no forced layout
  }

  _nape(i) {
    while (this._napes.length <= i) {
      const node = document.createElement('div');
      node.className = 'wof-nape';
      node.style.display = 'none';
      this.el.napeLayer.appendChild(node);
      this._napes.push(node);
    }
    return this._napes[i];
  }

  _pop(node) {
    if (typeof node.animate !== 'function') return;
    node.animate(
      [{ transform: 'scale(1.5)', filter: 'brightness(1.7)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
      { duration: 340, easing: 'ease-out' });
  }
}
