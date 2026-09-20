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
  const liveClock = $('#liveClock');
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
    prep: 15,   // seconds
    work: 180,
    rest: 60,
    rounds: 6,
    activeKey: null
  };

  /* ===================================================================
     SOUND ENGINE
     -------------------------------------------------------------------
     MASTER_VOLUME  : volume generale. 1.0 = forte. Puoi salire fino a
                      ~1.8: il compressore evita la distorsione.
     AUDIO_SESSION  : come convivere con la musica già in riproduzione.
       'transient'  → i beep si sovrappongono alla musica abbassandola
                      per un istante (consigliato). Il tasto Silenzioso
                      dell'iPhone però li zittisce.
       'ambient'    → si sovrappongono senza abbassare nulla.
       'playback'   → suona anche in modalità Silenzioso, ma mette in
                      pausa la musica.
     Richiede Safari 16.4+ / iOS 16.4+. Sui sistemi più vecchi l'API non
     esiste e il comportamento resta quello di default del browser.
     =================================================================== */
  const MASTER_VOLUME = 1.3;
  const AUDIO_SESSION = 'transient';

  let audioCtx = null;
  let masterGain = null;

  function setAudioSession(){
    try{
      if (navigator.audioSession) navigator.audioSession.type = AUDIO_SESSION;
    }catch(e){ /* non supportato: ignora */ }
  }
  setAudioSession();

  function getAudioCtx(){
    if (!audioCtx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      setAudioSession();
      audioCtx = new AC();

      // Compressore in uscita: alza il volume percepito senza clipping
      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 12;
      comp.attack.value = 0.002;
      comp.release.value = 0.15;

      masterGain = audioCtx.createGain();
      masterGain.gain.value = MASTER_VOLUME;

      masterGain.connect(comp);
      comp.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended'){
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    return audioCtx;
  }

  // Un tono "pieno": fondamentale + quinta armonica + un filo di onda quadra.
  // Molto più udibile dell'onda sinusoidale pura sugli altoparlanti piccoli.
  function beep(freq, duration, delay = 0, level = 1){
    const ctx = getAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay + 0.01;
    const peak = Math.max(0.001, 0.9 * level);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    env.gain.setValueAtTime(peak, t0 + duration * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    env.connect(masterGain);

    const voices = [
      { type: 'sine',     mul: 1, gain: 1.0  },
      { type: 'sine',     mul: 2, gain: 0.40 },
      { type: 'square',   mul: 1, gain: 0.22 },
      { type: 'triangle', mul: 3, gain: 0.12 }
    ];

    voices.forEach(v => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = v.type;
      osc.frequency.value = freq * v.mul;
      g.gain.value = v.gain;
      osc.connect(g);
      g.connect(env);
      osc.start(t0);
      osc.stop(t0 + duration + 0.08);
    });
  }

  function playPhaseSound(type){
    switch(type){
      case 'PREP':
        beep(660, 0.26);
        break;
      case 'WORK':
        beep(880, 0.18);
        beep(1175, 0.30, 0.18);
        break;
      case 'REST':
        beep(523, 0.22);
        beep(392, 0.34, 0.20);
        break;
      case 'END':
        beep(880, 0.18, 0);
        beep(880, 0.18, 0.22);
        beep(1175, 0.45, 0.44);
        break;
    }
  }

  // Sblocco dell'audio al primo tocco, ovunque sulla pagina
  function unlockAudio(){
    const ctx = getAudioCtx();
    if (!ctx) return;
    // tono praticamente muto: serve solo a "svegliare" l'output su iOS
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }
  ['touchend','pointerdown','click'].forEach(ev => {
    document.addEventListener(ev, unlockAudio, { once:true, passive:true });
  });

  // Tornando sull'app dopo un cambio di scheda l'audio va risvegliato
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended'){
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  });

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

  // Click al centro del cerchio live: pausa/riprendi
  liveClock.addEventListener('click', () => {
    if (!running) return;
    if (paused) resumeSequence(); else pauseSequence();
  });

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
    // un solo listener di scroll per wheel, anche se la ricostruiamo
    if (!el._markerBound){
      el.addEventListener('scroll', syncMarker, { passive: true });
      el._markerBound = true;
    }
    el._syncMarker = syncMarker;
    syncMarker();

    let padPx = 0;
    function setSpacers(){
      const h = el.clientHeight;
      padPx = Math.max(0, Math.round(h/2 - ITEM_H()/2));
      topSpacer.style.height = padPx + 'px';
      bottomSpacer.style.height = padPx + 'px';
    }
    setSpacers();

    if (window.ResizeObserver){
      if (el._ro) el._ro.disconnect();
      el._ro = new ResizeObserver(setSpacers);
      el._ro.observe(el);
    } else {
      // fallback per browser senza ResizeObserver
      window.addEventListener('resize', setSpacers);
      window.addEventListener('orientationchange', setSpacers);
    }

    function selectIndex(i, smooth=false){
      i = Math.max(0, Math.min(values.length-1, i));
      items.forEach(it => it.classList.remove('selected'));
      items[i].classList.add('selected');
      if (smooth) el.classList.add('smooth-scroll'); else el.classList.remove('smooth-scroll');
      const top = i * ITEM_H();
      if (el.scrollTo) el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
      else el.scrollTop = top;
    }
    selectIndex(selectedIndex, false);

    // Snap on scroll end
    if (!el._snapBound){
      el.addEventListener('scroll', () => {
        clearTimeout(el._snapT);
        el._snapT = setTimeout(() => {
          const i = Math.round(el.scrollTop / ITEM_H());
          if (el._selectIndex) el._selectIndex(i, true);
        }, 90);
      }, { passive: true });
      el._snapBound = true;
    }
    el._selectIndex = selectIndex;

    el.getSelected = () => {
      const i = Math.max(0, Math.min(values.length-1, Math.round(el.scrollTop / ITEM_H())));
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
  let running = false;
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

    // Sblocca l'audio context al gesto utente (richiesto dai browser)
    getAudioCtx();

    running = true;
    paused = false;

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
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    app.classList.remove('running');
    configView.removeAttribute('aria-hidden');
    liveView.hidden = true;
    paused = false;
    running = false;
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
    playPhaseSound(phase.type);

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

  function loop(){
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
        playPhaseSound('END');
        cancelAnimationFrame(rafId);
        rafId = null;
        running = false;
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
  $$('.bubble .ring').forEach(ring => ring.style.stroke = 'var(--ring-bg)');

})();

/* ===== Tema: Dark/Light toggle (sole ⇄ luna) ===== */
(() => {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const root = document.documentElement;
  const STORAGE_KEY = 'theme';

  const metaTheme = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (mode) => {
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
      btn.setAttribute('aria-label', 'Attiva dark mode');
      btn.setAttribute('aria-pressed', 'true');
      if (metaTheme) metaTheme.setAttribute('content', '#f7fafc');
    } else {
      root.removeAttribute('data-theme'); // default: dark
      btn.setAttribute('aria-label', 'Attiva light mode');
      btn.setAttribute('aria-pressed', 'false');
      if (metaTheme) metaTheme.setAttribute('content', '#0b0d10');
    }
  };

  // Preferenza salvata o fallback al sistema, default dark
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch(e){}
  const systemPref = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const initial = saved || systemPref || 'dark';
  applyTheme(initial);

  btn.addEventListener('click', () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch(e){}
  }, { passive: true });
})();
