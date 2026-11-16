// Écran de veille : les deux chats (le tigré « t » et le noir « b »).
// Chaque étape fixe la position, le sens, l'allure et la durée de la transition.
const BEATS = [
  { ms: 120, t: { x: -200, y: 0, face: 1, pose: 'walk', dur: 0, hidden: false }, b: { x: 1340, y: 0, face: -1, pose: 'walk', dur: 0, hidden: false }, fight: false },
  { ms: 4200, t: { x: 250, dur: 4.2, ease: 'linear' }, b: { x: 790, dur: 4.2, ease: 'linear' } },
  { ms: 1600, t: { pose: 'sit' }, b: { pose: 'sit' } },
  { ms: 500, t: { pose: 'run', x: 470, dur: 0.5, ease: 'ease-in' } },
  { ms: 3200, t: { hidden: true, dur: 0 }, b: { hidden: true, x: 570, dur: 0.25, ease: 'ease-out' }, fight: true },
  { ms: 1300, t: { hidden: false, pose: 'sit' }, b: { hidden: false, pose: 'run', face: 1, x: 1400, dur: 1.1, ease: 'ease-in' }, fight: false },
  { ms: 2200, t: { pose: 'walk', x: 690, dur: 2.2, ease: 'linear' } },
  { ms: 900, t: { pose: 'sit' } },
  { ms: 700, b: { pose: 'run', face: -1, x: 880, dur: 0.7, ease: 'ease-out' } },
  { ms: 350, t: { pose: 'jump', y: -130, dur: 0.35, ease: 'ease-out' } },
  { ms: 350, t: { y: 0, face: -1, dur: 0.35, ease: 'ease-in' } },
  { ms: 1500, t: { pose: 'run', x: -260, dur: 1.2, ease: 'linear' }, b: { x: -220, dur: 1.5, ease: 'linear' } },
  { ms: 900 },
  { ms: 120, b: { x: -220, face: 1, pose: 'walk', dur: 0 } },
  { ms: 3000, b: { x: 380, dur: 3, ease: 'linear' } },
  { ms: 1400, b: { pose: 'sit' }, t: { x: 1340, face: -1, pose: 'run', dur: 0 } },
  { ms: 1100, t: { x: 640, dur: 1.1, ease: 'ease-out' } },
  { ms: 450, t: { pose: 'jump', x: 470, y: -210, dur: 0.45, ease: 'ease-out' } },
  { ms: 450, t: { x: 230, y: 0, dur: 0.45, ease: 'ease-in' } },
  { ms: 2600, t: { pose: 'sit', face: 1 }, b: { face: -1 } },
  { ms: 250, t: { pose: 'walk' }, b: { pose: 'walk', face: 1 } },
  { ms: 6000, t: { x: 1380, dur: 6, ease: 'linear' }, b: { x: 1500, dur: 6, ease: 'linear' } },
  { ms: 1000 }
];

let timer = null, i = 0;
const state = { t: {}, b: {}, fight: false };

function paint(el, c) {
  el.style.transition = `transform ${c.dur || 0}s ${c.ease || 'linear'}, opacity .25s ease`;
  el.style.transform = `translate(${c.x || 0}px, ${c.y || 0}px)`;
  el.style.opacity = c.hidden ? '0' : '1';
  el.firstElementChild.style.transform = `scaleX(${c.face || 1})`;
  el.classList.toggle('sit', c.pose === 'sit');
  el.classList.toggle('run', c.pose === 'run');
  el.classList.toggle('jump', c.pose === 'jump');
}
function apply(beat) {
  state.t = { ...state.t, ...(beat.t || {}) };
  state.b = { ...state.b, ...(beat.b || {}) };
  if (beat.fight !== undefined) state.fight = beat.fight;
  paint(document.getElementById('cat-t'), state.t);
  paint(document.getElementById('cat-b'), state.b);
  document.querySelector('.vl-fight').classList.toggle('on', state.fight);
}
export function startCats() {
  stopCats();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply({ t: { x: 300, y: 0, face: 1, pose: 'sit', dur: 0, hidden: false }, b: { x: 620, y: 0, face: -1, pose: 'sit', dur: 0, hidden: false }, fight: false });
    return;
  }
  i = 0; apply(BEATS[0]);
  const next = () => {
    i = (i + 1) % BEATS.length;
    apply(BEATS[i]);
    timer = setTimeout(next, BEATS[i].ms);
  };
  timer = setTimeout(next, BEATS[0].ms);
}
export function stopCats() { clearTimeout(timer); timer = null; }
