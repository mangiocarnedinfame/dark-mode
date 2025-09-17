/* Interval Timer – 2x2 bubbles + live view
   Uses a two-wheel picker for times and single-wheel picker for rounds.
*/

(function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const app = $('#app');
  const configView = $('#configView');
  const liveView = $('#liveView');
  const phaseLabel = $('#phaseLabel');
  const liveTime = $('#liveTime');
  const liveRing = $('#liveRing');
  const startBtn = $('#startBtn');
  const pauseBtn = $('#pauseBtn');
  const resumeBtn = $('#resumeBtn');
  const stopBtn = $('#stopBtn');

  const pickerOverlay = $('#pickerOverlay');
  const pickerTitle = $('#pickerTitle');
  const wheelsWrap = $('#wheels');
  const minutesWheel = $('#minutesWheel');
  const secondsWheel = $('#secondsWheel');
  const colMinutes = $('#colMinutes');
  const colSeconds = $('#colSeconds');
  const labelMinutes = $('#labelMinutes');
  const labelSeconds = $('#labelSeconds');
  const confirmPicker = $('#confirmPicker');
  const cancelPicker = $('#cancelPicker');

  // State
  const state = {
    prep: 10,   // seconds
    work: 90,
    rest: 60,
    rounds: 3,
    activeKey: null
  };

  // Attach click handlers to bubbles
  $$('.bubble').forEach(b => {
    b.addEventListener('click', () => openPicker(b.dataset.key));
  });

  startBtn.addEventListener('click', () => {
    startSequence();
  });
  stopBtn.addEventListener('click', stopSequence);
  pauseBtn.addEventListener('click', pauseSequence);
  resumeBtn.addEventListener('click', resumeSequence);
  cancelPicker.addEventListener('click', closePicker);
  confirmPicker.addEventListener('click', applyPickerSelection);

  // --- Ring sizing logic (for live clock)
  const r = 88;
  const circumference = 2 * Math.PI * r;
  liveRing.style.strokeDasharray = `${circumference} ${circumference}`;
  liveRing.style.strokeDashoffset = `0`;

  // --- Helpers
  function pad(n){ return String(n).padStart(2,'0'); }
  function fmt(t){
    const m = Math.floor(t/60); const s = t%60;
    return `${pad(m)}:${pad(s)}`;
  }
  function updateBubbles(){
    $('#prepBubble [data-role="value"]').textContent = fmt(state.prep);
    $('#workBubble [data-role="value"]').textContent = fmt(state.work);
    $('#restBubble [data-role="value"]').textContent = fmt(state.rest);
    $('#roundsBubble [data-role="value"]').textContent = pad(state.rounds);
  }
  updateBubbles();

  // --- Wheel builder (stable, snap-to-center)
  const ITEM_H = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--wheel-item-h')) || 128;

  function buildWheel(el, values, formatFn, selectedIndex=0){
    el.innerHTML = '';
    el.classList.remove('smooth-scroll');

    // Build list
    const ul = document.createElement('ul');
    ul.className = 'list';
    const topSpacer = document.createElement('li'); topSpacer.className = 'spacer'; ul.appendChild(topSpacer);

    const items = values.map((val, i) => {
      const li = document.createElement('li');
      li.className = 'wheel-item';
      li.dataset.index = i;
      li.textContent = formatFn ? formatFn(val) : String(val);
      ul.appendChild(li);
      return li;
    });

    const bottomSpacer = document.createElement('li'); bottomSpacer.className = 'spacer'; ul.appendChild(bottomSpacer);
    el.appendChild(ul);

    function syncMarker(){
    // Mantiene il quadratino fermo al centro mentre la lista scorre
      el.style.setProperty('--wheelScroll', el.scrollTop + 'px');
  }
    el.addEventListener('scroll', syncMarker, { passive: true });
    syncMarker(); // inizializza


    let padPx = 0;
    function setSpacers(){
      const h = el.clientHeight;
      padPx = Math.max(0, Math.round(h/2 - ITEM_H()/2));
      topSpacer.style.height = padPx + 'px';
      bottomSpacer.style.height = padPx + 'px';
    }
    setSpacers();
    new ResizeObserver(setSpacers).observe(el);

    function selectIndex(i, smooth=false){
      i = Math.max(0, Math.min(values.length-1, i));
      items.forEach(it => it.classList.remove('selected'));
      items[i].classList.add('selected');
      if (smooth) el.classList.add('smooth-scroll'); else el.classList.remove('smooth-scroll');
      el.scrollTo({ top: i * ITEM_H(), behavior: smooth ? 'smooth' : 'auto' });
    }
    selectIndex(selectedIndex, false);

    // Snap on scroll end
    let stId = null;
    el.addEventListener('scroll', () => {
      if (stId) cancelAnimationFrame(stId);
      stId = requestAnimationFrame(() => {
        // Debounce with small delay
        clearTimeout(el._snapT);
        el._snapT = setTimeout(() => {
          const i = Math.round(el.scrollTop / ITEM_H());
          selectIndex(i, true);
        }, 80);
      });
    });

    el.getSelected = () => {
      const i = Math.round(el.scrollTop / ITEM_H());
      return { index: i, value: values[i] };
    };
    el.setSelectedIndex = (i) => selectIndex(i, false);
  }

  // --- Picker flow
  function openPicker(key){
    state.activeKey = key;
    pickerOverlay.hidden = false;
    document.body.style.overflow = 'hidden';

    const isRounds = key === 'rounds';
    wheelsWrap.classList.toggle('single', isRounds);
    colMinutes.classList.toggle('round-mode', isRounds);

    if (isRounds){
      pickerTitle.textContent = 'Imposta rounds';
      labelMinutes.textContent = 'Rounds';
      colSeconds.style.display = 'none';
      buildWheel(minutesWheel, range(1, 99), (v) => String(v), state.rounds-1);
    } else {
      pickerTitle.textContent = 'Imposta ' + keyLabel(key);
      labelMinutes.textContent = 'Minuti';
      labelSeconds.textContent = 'Secondi';
      colSeconds.style.display = '';
      const current = state[key];
      const m = Math.floor(current/60), s = current % 60;
      buildWheel(minutesWheel, range(0,59), v => pad(v), m);
      buildWheel(secondsWheel, range(0,59), v => pad(v), s);
    }
  }

  function closePicker(){
    pickerOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  function applyPickerSelection(){
    if (!state.activeKey) return;
    const key = state.activeKey;
    if (key === 'rounds'){
      const { value } = minutesWheel.getSelected();
      state.rounds = value;
    } else {
      const m = minutesWheel.getSelected().value;
      const s = secondsWheel.getSelected().value;
      state[key] = m*60 + s;
    }
    updateBubbles();
    closePicker();
  }

  function keyLabel(k){
    switch(k){
      case 'prep': return 'Prep';
      case 'work': return 'Work';
      case 'rest': return 'Rest';
      case 'rounds': return 'Rounds';
      default: return k;
    }
  }

  function range(a,b){ // inclusive
    const out = [];
    for(let i=a;i<=b;i++) out.push(i);
    return out;
  }

  // ----- Sequence engine -----
  let rafId = null;
  let phaseList = [];
  let phaseIdx = 0;
  let phaseEnd = 0;
  let paused = false;
  let remainingMs = 0;

  function buildPhases(){
    const list = [];
    if (state.prep > 0) list.push({ type:'PREP', seconds: state.prep });
    for (let i=1;i<=state.rounds;i++){
      if (state.work > 0) list.push({ type:'WORK', seconds: state.work, round:i });
      if (state.rest > 0) list.push({ type:'REST', seconds: state.rest, round:i });
    }
    return list;
  }

  function startSequence(){
    phaseList = buildPhases();
    if (!phaseList.length) return;

    // UI transitions
    app.classList.add('running');
    configView.setAttribute('aria-hidden','true');
    liveView.hidden = false;

    pauseBtn.hidden = false;
    resumeBtn.hidden = true;

    phaseIdx = 0;
    startPhase(phaseList[0]);
    loop();
  }

  function stopSequence(){
    cancelAnimationFrame(rafId);
    rafId = null;
    app.classList.remove('running');
    configView.removeAttribute('aria-hidden');
    liveView.hidden = true;
    paused = false;
    remainingMs = 0;
    // reset ring
    liveRing.style.stroke = 'var(--accent-start)';
    liveRing.style.strokeDashoffset = `${circumference}`;
  }

  function pauseSequence(){
    paused = true;
    pauseBtn.hidden = true;
    resumeBtn.hidden = false;
  }
  function resumeSequence(){
    // re-schedule end using the remaining time
    phaseEnd = performance.now() + remainingMs;
    paused = false;
    pauseBtn.hidden = false;
    resumeBtn.hidden = true;
  }

  function startPhase(phase){
    phaseLabel.textContent = phase.type + (phase.round ? ` • ${phase.round}/${state.rounds}` : '');
    setPhaseColor(phase.type);

    remainingMs = phase.seconds * 1000;
    phaseEnd = performance.now() + remainingMs;
    updateLiveDisplay(remainingMs, phase.seconds);
  }

  function setPhaseColor(type){
    switch(type){
      case 'PREP': liveRing.style.stroke = 'var(--accent-mid)'; break;
      case 'WORK': liveRing.style.stroke = 'var(--accent-start)'; break;
      case 'REST': liveRing.style.stroke = 'var(--accent-end)'; break;
      default: liveRing.style.stroke = 'var(--accent-start)';
    }
  }

  function loop(now){
    rafId = requestAnimationFrame(loop);
    if (paused) return;

    const t = performance.now();
    remainingMs = Math.max(0, phaseEnd - t);

    const phase = phaseList[phaseIdx];
    updateLiveDisplay(remainingMs, phase.seconds);

    if (remainingMs <= 0){
      // next phase
      phaseIdx++;
      if (phaseIdx >= phaseList.length){
        // done
        phaseLabel.textContent = 'FINE';
        liveTime.textContent = '00:00';
        liveRing.style.strokeDashoffset = '0';
        cancelAnimationFrame(rafId);
        rafId = null;
        // auto-show stop so user can go back
        pauseBtn.hidden = true;
        resumeBtn.hidden = true;
        return;
      }
      startPhase(phaseList[phaseIdx]);
    }
  }

  function updateLiveDisplay(msLeft, totalSec){
    const secLeft = Math.ceil(msLeft / 1000);
    liveTime.textContent = fmt(secLeft);

    const elapsed = (totalSec * 1000 - msLeft) / 1000;
    const progress = Math.min(1, Math.max(0, elapsed / Math.max(1,totalSec)));
    const offset = circumference * progress;   // cresce da 0 -> circumf
    liveRing.style.strokeDashoffset = `${offset}`;

  }

  // Init bubbles rings to a neutral color
  $$('.bubble .ring').forEach(r => r.style.stroke = 'var(--ring-bg)');

})();

/* ===== Tema: Dark/Light toggle (sole ⇄ luna) ===== */
(() => {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const root = document.body;
  const STORAGE_KEY = 'theme';

  const applyTheme = (mode) => {
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
      btn.setAttribute('aria-label', 'Attiva dark mode');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      root.removeAttribute('data-theme'); // default: dark
      btn.setAttribute('aria-label', 'Attiva light mode');
      btn.setAttribute('aria-pressed', 'false');
    }
  };

  // Preferenza salvata o fallback al sistema, default dark
  const saved = localStorage.getItem(STORAGE_KEY);
  const systemPref = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const initial = saved || systemPref || 'dark';
  applyTheme(initial);

  btn.addEventListener('click', () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, { passive: true });
})();

