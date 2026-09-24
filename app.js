(function () {
  "use strict";

  var ITEM_HEIGHT = window.innerHeight <= 650 ? 60 : 70;
  var defaults = { warmup: [0, 30], work: [0, 40], rest: [0, 20], rounds: 6 };
  var settings = loadSettings();
  var wheels = {};
  var phases = [];
  var phaseIndex = 0;
  var phaseDuration = 0;
  var remainingMs = 0;
  var endAt = 0;
  var ticker = null;
  var paused = false;
  var lastShownSecond = -1;
  var audioContext = null;

  var setupScreen = document.getElementById("setup");
  var timerScreen = document.getElementById("timer");
  var phaseLabel = document.getElementById("phase-label");
  var minutesDisplay = document.getElementById("minutes-display");
  var secondsDisplay = document.getElementById("seconds-display");
  var progressBar = document.getElementById("progress-bar");
  var phasePill = document.getElementById("phase-pill");
  var tapHint = document.getElementById("tap-hint");
  var pauseControls = document.getElementById("pause-controls");
  var setupError = document.getElementById("setup-error");
  var themeMeta = document.querySelector('meta[name="theme-color"]');

  applySavedTheme();
  buildTimeWheels();
  buildRoundsWheel();
  window.setTimeout(positionWheels, 0);
  bindEvents();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js");
    });
  }

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem("gymTimerSettings"));
      if (saved && saved.warmup && saved.work && saved.rest && saved.rounds) return saved;
    } catch (ignore) {}
    return defaults;
  }

  function saveSettings() {
    try { localStorage.setItem("gymTimerSettings", JSON.stringify(settings)); } catch (ignore) {}
  }

  function applySavedTheme() {
    var dark = false;
    try { dark = localStorage.getItem("gymTimerTheme") === "dark"; } catch (ignore) {}
    if (dark) document.documentElement.className = "dark";
    updateThemeUI();
  }

  function updateThemeUI() {
    var dark = document.documentElement.className.indexOf("dark") !== -1;
    document.getElementById("theme-toggle").setAttribute("aria-label", dark ? "Attiva modalità chiara" : "Attiva modalità scura");
    themeMeta.setAttribute("content", dark ? "#10110f" : "#f5f3ed");
  }

  function buildTimeWheels() {
    var holders = document.querySelectorAll(".time-wheel");
    for (var i = 0; i < holders.length; i++) {
      var key = holders[i].getAttribute("data-setting");
      var minuteWheel = createWheel(0, 59, settings[key][0], key + "-minutes", true);
      var colon = document.createElement("div");
      var secondWheel = createWheel(0, 59, settings[key][1], key + "-seconds", true);
      colon.className = "wheel-colon";
      colon.innerHTML = ":";
      holders[i].appendChild(minuteWheel.el);
      holders[i].appendChild(colon);
      holders[i].appendChild(secondWheel.el);
      wheels[key + "-minutes"] = minuteWheel;
      wheels[key + "-seconds"] = secondWheel;
    }
  }

  function buildRoundsWheel() {
    var holder = document.getElementById("rounds-wheel");
    var roundWheel = createWheel(1, 99, settings.rounds, "rounds", false);
    holder.appendChild(roundWheel.el);
    wheels.rounds = roundWheel;
  }

  function createWheel(min, max, initial, name, pad) {
    var el = document.createElement("div");
    var list = document.createElement("ul");
    var timer;
    el.className = "wheel";
    el.setAttribute("role", "listbox");
    el.setAttribute("aria-label", name);
    list.className = "wheel-list";
    for (var value = min; value <= max; value++) {
      var item = document.createElement("li");
      item.className = "wheel-item" + (value === initial ? " selected" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", value === initial ? "true" : "false");
      item.setAttribute("data-value", value);
      item.innerHTML = pad ? two(value) : String(value);
      list.appendChild(item);
    }
    el.appendChild(list);
    el.scrollTop = (initial - min) * ITEM_HEIGHT;
    el.addEventListener("scroll", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        var index = Math.round(el.scrollTop / ITEM_HEIGHT);
        index = Math.max(0, Math.min(max - min, index));
        el.scrollTop = index * ITEM_HEIGHT;
        selectWheelItem(el, index);
        updateSetting(name, index + min);
      }, 90);
    });
    return { el: el, min: min, max: max, initial: initial };
  }

  function positionWheels() {
    var name;
    for (name in wheels) {
      if (wheels.hasOwnProperty(name)) {
        wheels[name].el.scrollTop = (wheels[name].initial - wheels[name].min) * ITEM_HEIGHT;
      }
    }
  }

  function selectWheelItem(el, index) {
    var items = el.querySelectorAll(".wheel-item");
    for (var i = 0; i < items.length; i++) {
      var selected = i === index;
      items[i].className = "wheel-item" + (selected ? " selected" : "");
      items[i].setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function updateSetting(name, value) {
    if (name === "rounds") settings.rounds = value;
    else {
      var parts = name.split("-");
      settings[parts[0]][parts[1] === "minutes" ? 0 : 1] = value;
    }
    saveSettings();
    setupError.innerHTML = "";
  }

  function bindEvents() {
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    document.getElementById("start-button").addEventListener("click", startWorkout);
    document.getElementById("time-display").addEventListener("click", pauseWorkout);
    document.getElementById("resume-button").addEventListener("click", resumeWorkout);
    document.getElementById("end-button").addEventListener("click", endWorkout);
    window.addEventListener("orientationchange", function () {
      window.setTimeout(function () { ITEM_HEIGHT = window.innerHeight <= 650 ? 60 : 70; }, 200);
    });
  }

  function toggleTheme() {
    var root = document.documentElement;
    var dark = root.className.indexOf("dark") === -1;
    root.className = dark ? "dark" : "";
    try { localStorage.setItem("gymTimerTheme", dark ? "dark" : "light"); } catch (ignore) {}
    updateThemeUI();
  }

  function startWorkout() {
    unlockAudio();
    syncSettingsFromWheels();
    phases = makePhases();
    if (!phases.length) {
      setupError.innerHTML = "Imposta almeno un tempo maggiore di zero.";
      return;
    }
    setupScreen.hidden = true;
    timerScreen.hidden = false;
    phaseIndex = 0;
    paused = false;
    document.getElementById("resume-button").hidden = false;
    document.getElementById("end-button").innerHTML = "TERMINA";
    showPauseUI(false);
    beginPhase();
  }

  function syncSettingsFromWheels() {
    var name;
    for (name in wheels) {
      if (wheels.hasOwnProperty(name)) {
        var wheel = wheels[name];
        var value = Math.round(wheel.el.scrollTop / ITEM_HEIGHT) + wheel.min;
        value = Math.max(wheel.min, Math.min(wheel.max, value));
        updateSetting(name, value);
      }
    }
  }

  function makePhases() {
    var result = [];
    var warmupSeconds = toSeconds(settings.warmup);
    var workSeconds = toSeconds(settings.work);
    var restSeconds = toSeconds(settings.rest);
    if (warmupSeconds > 0) result.push({ label: "WARM UP", seconds: warmupSeconds });
    for (var round = 1; round <= settings.rounds; round++) {
      if (workSeconds > 0) result.push({ label: "WORK " + round + "/" + settings.rounds, seconds: workSeconds });
      if (round < settings.rounds && restSeconds > 0) result.push({ label: "REST " + round + "/" + settings.rounds, seconds: restSeconds });
    }
    return result;
  }

  function beginPhase() {
    window.clearInterval(ticker);
    if (phaseIndex >= phases.length) {
      completeWorkout();
      return;
    }
    var phase = phases[phaseIndex];
    phaseDuration = phase.seconds * 1000;
    remainingMs = phaseDuration;
    endAt = Date.now() + remainingMs;
    lastShownSecond = -1;
    phaseLabel.innerHTML = phase.label;
    phasePill.innerHTML = phase.label.indexOf("REST") === 0 ? "RECUPERO" : "IN CORSO";
    progressBar.style.webkitTransform = "scaleX(1)";
    progressBar.style.transform = "scaleX(1)";
    renderTick();
    ticker = window.setInterval(tick, 100);
  }

  function tick() {
    remainingMs = Math.max(0, endAt - Date.now());
    renderTick();
    if (remainingMs <= 0) {
      window.clearInterval(ticker);
      playTone(880, .18, true);
      phaseIndex++;
      window.setTimeout(beginPhase, 220);
    }
  }

  function renderTick() {
    var shownSeconds = Math.ceil(remainingMs / 1000);
    if (shownSeconds !== lastShownSecond) {
      minutesDisplay.innerHTML = two(Math.floor(shownSeconds / 60));
      secondsDisplay.innerHTML = two(shownSeconds % 60);
      if (shownSeconds > 0 && shownSeconds <= 3) playTone(520, .08, false);
      lastShownSecond = shownSeconds;
    }
    var ratio = phaseDuration ? remainingMs / phaseDuration : 0;
    progressBar.style.webkitTransform = "scaleX(" + ratio + ")";
    progressBar.style.transform = "scaleX(" + ratio + ")";
  }

  function pauseWorkout() {
    if (paused || timerScreen.hidden) return;
    paused = true;
    remainingMs = Math.max(0, endAt - Date.now());
    window.clearInterval(ticker);
    phasePill.innerHTML = "IN PAUSA";
    showPauseUI(true);
  }

  function resumeWorkout() {
    if (!paused) return;
    paused = false;
    endAt = Date.now() + remainingMs;
    phasePill.innerHTML = phases[phaseIndex].label.indexOf("REST") === 0 ? "RECUPERO" : "IN CORSO";
    showPauseUI(false);
    ticker = window.setInterval(tick, 100);
  }

  function showPauseUI(show) {
    pauseControls.hidden = !show;
    tapHint.hidden = show;
  }

  function endWorkout() {
    window.clearInterval(ticker);
    paused = false;
    timerScreen.hidden = true;
    setupScreen.hidden = false;
    showPauseUI(false);
  }

  function completeWorkout() {
    phaseLabel.innerHTML = "COMPLETATO";
    phasePill.innerHTML = "FINE";
    minutesDisplay.innerHTML = "00";
    secondsDisplay.innerHTML = "00";
    progressBar.style.webkitTransform = "scaleX(0)";
    progressBar.style.transform = "scaleX(0)";
    paused = true;
    tapHint.hidden = true;
    pauseControls.hidden = false;
    document.getElementById("resume-button").hidden = true;
    document.getElementById("end-button").innerHTML = "NUOVO TIMER";
    playTone(660, .5, true);
  }

  function unlockAudio() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === "suspended" && audioContext.resume) audioContext.resume();
    var oscillator = audioContext.createOscillator();
    var gain = audioContext.createGain();
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(0);
    oscillator.stop(audioContext.currentTime + .01);
  }

  function playTone(frequency, duration, doubleTone) {
    if (!audioContext) return;
    try {
      sound(frequency, duration, 0);
      if (doubleTone) sound(frequency * 1.18, duration, duration + .06);
    } catch (ignore) {}
  }

  function sound(frequency, duration, delay) {
    var start = audioContext.currentTime + delay;
    var oscillator = audioContext.createOscillator();
    var gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.18, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  function toSeconds(pair) { return pair[0] * 60 + pair[1]; }
  function two(number) { return number < 10 ? "0" + number : String(number); }
})();
