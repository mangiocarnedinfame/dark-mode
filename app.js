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
     MASTER_VOLUME  : volume del motore completo (iPhone / Safari recenti).
                      Da 0.6 a 1.6. Il compressore evita la distorsione.
     SIMPLE_VOLUME  : volume del motore semplificato (iPad mini, iOS 12).
                      Qui non c'e' compressore: sopra 1.0 si distorce.
     FORCE_SIMPLE   : mettilo a true per usare il motore semplificato
                      ovunque, se anche su iPhone senti gracchiare.
     AUDIO_SESSION  : convivenza con la musica gia' in riproduzione.
       'transient'  -> beep sovrapposti, musica abbassata un istante
                       (consigliato, ma il tasto Silenzioso li zittisce).
       'ambient'    -> sovrapposti senza abbassare nulla.
       'playback'   -> suonano anche in Silenzioso, ma la musica va in pausa.
       Richiede iOS 16.4+; sui sistemi piu' vecchi l'API non esiste.
     =================================================================== */
  const MASTER_VOLUME = 1.15;
  const SIMPLE_VOLUME = 0.85;
  const FORCE_SIMPLE  = false;
  const AUDIO_SESSION = 'transient';

  // WebKit vecchio (iOS 12/13): esiste solo la versione col prefisso.
  // Su questi dispositivi serve un grafo audio piu' leggero.
  const SIMPLE_AUDIO = FORCE_SIMPLE || !('AudioContext' in window);

  let audioCtx = null;
  let masterGain = null;
  let keepAlive = null;
  let ctxWasRunning = false;   // il contesto ha gia' suonato almeno una volta
  let ctxBroken = false;       // interrotto da iOS: va ricostruito, non ripreso

  function setAudioSession(){
    try{
      if (navigator.audioSession) navigator.audioSession.type = AUDIO_SESSION;
    }catch(e){ /* non supportato: ignora */ }
  }
  setAudioSession();

  function buildAudio(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    setAudioSession();

    let ctx;
    try { ctx = new AC(); } catch(e){ return null; }

    const master = ctx.createGain();
    master.gain.value = SIMPLE_AUDIO ? SIMPLE_VOLUME : MASTER_VOLUME;

    if (SIMPLE_AUDIO){
      // niente compressore: meno lavoro per la CPU dei dispositivi vecchi
      master.connect(ctx.destination);
    } else {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 14;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ctx.destination);
    }

    // Se iOS interrompe la sessione (schermo spento, app in background,
    // cambio di uscita audio) il contesto resta in uno stato difettoso e
    // il suono diventa gracchiante: lo marchiamo come da ricostruire
    // invece di limitarci a fargli resume().
    ctx.onstatechange = function(){
      if (ctx !== audioCtx) return;
      if (ctx.state === 'running') ctxWasRunning = true;
      else if (ctxWasRunning) ctxBroken = true;
    };

    audioCtx = ctx;
    masterGain = master;
    ctxWasRunning = false;
    ctxBroken = false;
    return ctx;
  }

  function teardownAudio(){
    stopKeepAlive();
    if (audioCtx){
      try{ audioCtx.close(); }catch(e){}
    }
    audioCtx = null;
    masterGain = null;
    ctxWasRunning = false;
    ctxBroken = false;
  }

  function getAudioCtx(){
    if (audioCtx && ctxBroken) teardownAudio();   // ricostruzione completa
    if (!audioCtx && !buildAudio()) return null;
    if (audioCtx.state !== 'running'){
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(function(){});
    }
    return audioCtx;
  }

  // Tono inudibile tenuto acceso per tutta la durata dell'allenamento:
  // impedisce a iOS di chiudere la sessione audio fra un beep e l'altro.
  function startKeepAlive(){
    const ctx = getAudioCtx();
    if (!ctx || keepAlive) return;
    try{
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 40;
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      keepAlive = { osc: osc, gain: g };
    }catch(e){}
  }
  function stopKeepAlive(){
    if (!keepAlive) return;
    try{
      keepAlive.osc.stop();
      keepAlive.osc.disconnect();
      keepAlive.gain.disconnect();
    }catch(e){}
    keepAlive = null;
  }

  // Tono composto. Sui dispositivi vecchi bastano due oscillatori: piu' voci
  // significano piu' CPU e, senza compressore, rischio di clipping.
  const VOICES = SIMPLE_AUDIO
    ? [
        { type: 'sine', mul: 1, gain: 1.0 },
        { type: 'sine', mul: 2, gain: 0.30 }
      ]
    : [
        { type: 'sine',     mul: 1, gain: 1.0  },
        { type: 'sine',     mul: 2, gain: 0.40 },
        { type: 'square',   mul: 1, gain: 0.22 },
        { type: 'triangle', mul: 3, gain: 0.12 }
      ];
  const PEAK   = SIMPLE_AUDIO ? 0.70 : 0.90;
  const ATTACK = SIMPLE_AUDIO ? 0.020 : 0.012;   // attacco morbido = niente click

  function beep(freq, duration, delay, level){
    delay = delay || 0;
    level = (level === undefined) ? 1 : level;

    const ctx = getAudioCtx();
    if (!ctx || !masterGain) return;

    const t0 = ctx.currentTime + delay + 0.02;
    const peak = Math.max(0.001, PEAK * level);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + ATTACK);
    env.gain.setValueAtTime(peak, t0 + duration * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    env.connect(masterGain);

    let pending = VOICES.length;

    VOICES.forEach(function(v){
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = v.type;
      osc.frequency.value = freq * v.mul;
      g.gain.value = v.gain;
      osc.connect(g);
      g.connect(env);
      osc.onended = function(){
        try{ osc.disconnect(); g.disconnect(); }catch(e){}
        pending--;
        if (pending <= 0){ try{ env.disconnect(); }catch(e){} }
      };
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
  ['touchend','pointerdown','click'].forEach(function(ev){
    document.addEventListener(ev, function(){ getAudioCtx(); }, { once:true, passive:true });
  });

  // Rientrando nell'app, se iOS aveva interrotto la sessione il contesto
  // viene buttato e ricostruito invece di essere ripreso com'era.
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) return;
    if (ctxBroken){
      teardownAudio();
      if (running){ buildAudio(); startKeepAlive(); }
    } else if (audioCtx && audioCtx.state !== 'running'){
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(function(){});
    }
  });
  window.addEventListener('pageshow', function(){
    if (ctxBroken) teardownAudio();
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

    // Contesto audio sempre nuovo, creato dentro il tap dell'utente:
    // e' il momento in cui iOS concede l'autorizzazione a suonare.
    teardownAudio();
    getAudioCtx();
    startKeepAlive();

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
    stopKeepAlive();
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
        setTimeout(stopKeepAlive, 1500);
        // auto-show stop so user can go back
        pauseBtn.hidden = true;
        resumeBtn.hidden = true;
        return;
      }
      startPhase(phaseList[phaseIdx]);
    }
  }

  let lastShownSec = -1;
  function updateLiveDisplay(msLeft, totalSec){
    const secLeft = Math.ceil(msLeft / 1000);
    // ridisegna il testo solo quando cambia davvero: una volta al secondo
    // invece di 60, conta parecchio sull'hardware vecchio
    if (secLeft !== lastShownSec){
      liveTime.textContent = fmt(secLeft);
      lastShownSec = secLeft;
    }

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
