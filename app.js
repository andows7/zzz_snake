(function () {
  'use strict';
  const { Game, Renderer, CONFIG } = window.SnakeDuel;
  const $ = id => document.getElementById(id);
  const dom = Object.fromEntries(['game', 'overlay', 'overlay-card', 'overlay-kicker', 'overlay-title', 'overlay-description', 'start-button', 'start-label', 'overlay-secondary', 'enter-hint', 'result-stats', 'score-digits', 'score-multiplier', 'length-value', 'time-value', 'best-score', 'rankings', 'team-totals', 'boost-bars', 'boost-state', 'boost-budget', 'kill-value', 'food-value', 'respawn-banner', 'respawn-count', 'screen-status', 'match-label', 'pause-button', 'sound-button', 'help-dialog', 'toast-container', 'touch-boost'].map(id => [id, $(id)]));
  const storage = {
    get(key, fallback) { try { return localStorage.getItem('snake-duel:' + key) || fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('snake-duel:' + key, String(value)); } catch { /* File URLs and private sessions can block storage. */ } }
  };
  let renderer;
  let game;
  let best = Number(storage.get('best', 0)) || 0;
  let uiClock = 0;
  let lastScore = -1;
  let wasNewBest = false;
  let helpPaused = false;
  const boosts = new Set();
  const toastTimers = new Set();

  class ArcadeAudio {
    constructor() { this.enabled = storage.get('sound', 'off') === 'on'; this.context = null; }
    unlock() {
      if (!this.enabled) return;
      try { this.context ||= new (window.AudioContext || window.webkitAudioContext)(); if (this.context.state === 'suspended') this.context.resume(); } catch { this.enabled = false; }
    }
    play(type) {
      if (!this.enabled || !this.context || this.context.state !== 'running') return;
      const notes = { pickup: [700, 1050, .065], diamond: [930, 1550, .16], star: [550, 1500, .3], death: [200, 45, .32], start: [420, 900, .2], kill: [300, 1100, .2], boost: [130, 65, .05] };
      const [from, to, duration] = notes[type] || notes.pickup;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const at = this.context.currentTime;
      osc.type = type === 'death' ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(from, at); osc.frequency.exponentialRampToValueAtTime(to, at + duration);
      gain.gain.setValueAtTime(.025, at); gain.gain.exponentialRampToValueAtTime(.001, at + duration);
      osc.connect(gain); gain.connect(this.context.destination); osc.start(at); osc.stop(at + duration);
    }
  }
  const audio = new ArcadeAudio();
  function toast(message, kind = '') {
    if (dom['toast-container'].children.length >= 3) dom['toast-container'].firstElementChild.remove();
    const element = document.createElement('div'); element.className = 'game-toast ' + kind; element.textContent = message;
    dom['toast-container'].append(element);
    const timer = setTimeout(() => { element.remove(); toastTimers.delete(timer); }, 2300); toastTimers.add(timer);
  }
  function handleEvent(event) {
    renderer?.event(event);
    if (event.type === 'pickup' && event.snake.isPlayer) {
      audio.play(event.food.type === 'diamond' ? 'diamond' : event.food.type === 'star' ? 'star' : 'pickup');
      if (event.food.type === 'diamond') toast(`闪耀钻石！长度 +5 / +${event.points.toLocaleString()}`);
      if (event.food.type === 'star') toast('★ 无敌 8 秒！撞碎你的对手！');
    }
    if (event.type === 'death') {
      if (event.snake.isPlayer) { audio.play('death'); releaseBoost(); }
      else if (event.killer?.isPlayer) { audio.play('kill'); toast(`拦截成功！${event.snake.name.split(' / ')[0]}已击破`, 'kill'); }
    }
    if (event.type === 'respawn' && event.snake.isPlayer) toast('重返赛场！2 秒保护时间');
    if (event.type === 'headClash' && event.snake.isPlayer) audio.play('boost');
    if (event.type === 'starSpawn') toast('★ 稀有补给出现：无敌星');
    if (event.type === 'hazardSpawn') toast('注意！新的障碍与爆雷正在入场');
    if (event.type === 'start') audio.play('start');
    if (event.type === 'finish') {
      releaseBoost();
      wasNewBest = event.result.score > best;
      if (wasNewBest) { best = event.result.score; storage.set('best', best); }
      showOverlay('finished');
    }
  }

  game = new Game({ onEvent: handleEvent });
  renderer = new Renderer(dom.game, game);
  dom['boost-bars'].innerHTML = '<i></i>'.repeat(12);
  function showOverlay(state) {
    const visible = ['ready', 'paused', 'finished'].includes(state);
    dom.overlay.hidden = !visible;
    dom['overlay-card'].classList.toggle('results', state === 'finished');
    dom['result-stats'].hidden = state !== 'finished';
    dom['enter-hint'].textContent = state === 'paused' ? 'PRESS P / ESC TO RESUME' : 'PRESS ENTER TO START';
    dom['overlay-secondary'].textContent = state === 'paused' ? '重新开始 ↻' : '玩法说明 ?';
    if (state === 'ready') {
      dom['overlay-kicker'].textContent = game.mode === 'team' ? 'TEAM BATTLE / 45 SECONDS' : 'GODFINGER ORIGINAL ARCADE';
      dom['overlay-title'].textContent = game.mode === 'team' ? '两蛇一心，合力出击！' : '准备好，大吃一场！';
      dom['overlay-description'].innerHTML = game.mode === 'team' ? '与你的蓝色搭档并肩作战。<br>45 秒后，总长度更长的队伍获胜。' : '收集魔豆，爆冲抢位。<br>用你的身体，给对手一个死胡同。';
      dom['start-label'].textContent = '开始对决';
    } else if (state === 'paused') {
      dom['overlay-kicker'].textContent = 'TAKE A BREATHER.';
      dom['overlay-title'].textContent = '对决暂停中';
      dom['overlay-description'].innerHTML = '休息一下，想好下一次转弯。<br>赛场和倒计时都在等你。';
      dom['start-label'].textContent = '继续对决';
    } else if (state === 'finished') {
      const result = game.result;
      dom['overlay-kicker'].textContent = wasNewBest ? 'NEW PERSONAL BEST!' : 'MATCH COMPLETE / GOOD GAME';
      dom['overlay-title'].textContent = game.mode === 'team' ? result.winner === -1 ? '势均力敌！' : result.winner === 0 ? '小队获胜！' : '下次，赢回来！' : '本局挑战完成';
      dom['overlay-description'].textContent = game.mode === 'team' ? `我方 ${result.teamLengths[0]} 节 / 对方 ${result.teamLengths[1]} 节` : `本次成绩 ${result.score.toLocaleString()} / 最佳 ${best.toLocaleString()}`;
      dom['result-stats'].innerHTML = `<div><small>本局得分</small><strong>${compact(result.score)}</strong></div><div><small>拦截击杀</small><strong>${result.kills}</strong></div><div><small>最长身体</small><strong>${result.maxLength}</strong></div>`;
      dom['start-label'].textContent = '再来一局';
      dom['enter-hint'].textContent = 'ONE MORE ROUND?';
    }
    dom['pause-button'].textContent = state === 'paused' ? '▶' : 'Ⅱ';
    dom['pause-button'].setAttribute('aria-label', state === 'paused' ? '继续游戏' : '暂停游戏');
    fitOverlay();
  }
  function fitOverlay() {
    const card = dom['overlay-card'], screen = $('screen');
    if (dom.overlay.hidden) return;
    const scale = Math.min(1, (screen.clientWidth - 24) / card.offsetWidth, (screen.clientHeight - 24) / card.offsetHeight);
    card.style.setProperty('--overlay-scale', Math.max(.1, scale));
  }
  const overlayObserver = new ResizeObserver(fitOverlay);
  overlayObserver.observe($('screen'));
  overlayObserver.observe(dom['overlay-card']);
  function compact(n) { return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n.toLocaleString(); }
  function startOrResume() {
    audio.unlock();
    if (game.state === 'paused') game.togglePause();
    else { if (game.state === 'finished') reset(game.mode); game.start(); }
    showOverlay(game.state);
    dom.game.focus({ preventScroll: true });
  }
  function reset(mode) {
    releaseBoost();
    for (const timer of toastTimers) clearTimeout(timer);
    toastTimers.clear(); dom['toast-container'].replaceChildren();
    game.reset(mode); renderer.event({ type: 'reset' }); lastScore = -1;
    document.querySelectorAll('.mode-button').forEach(button => { const selected = button.dataset.mode === mode; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    dom['match-label'].textContent = mode === 'team' ? '小队热斗 / 2 VS 2' : '经典对决 / SINGLE PLAYER';
    dom['match-label'].setAttribute('aria-label', mode === 'team' ? '切换到经典对决' : '切换到小队热斗');
    dom['team-totals'].hidden = mode !== 'team';
    showOverlay('ready'); updateUI();
  }
  function pause() {
    game.togglePause(); releaseBoost(); showOverlay(game.state);
  }
  function setBoost(source, down) {
    if (down && game.state === 'playing' && game.player.alive) { boosts.add(source); audio.unlock(); }
    else boosts.delete(source);
    game.player.boostRequested = boosts.size > 0;
    dom['touch-boost'].classList.toggle('active', boosts.size > 0 && game.player.canBoost);
  }
  function releaseBoost() { boosts.clear(); if (game) game.player.boostRequested = false; dom['touch-boost'].classList.remove('active'); }

  // Seven-segment digits match the cyan hardware display in the reference.
  const segments = [[1,1,1,1,1,1,0],[0,1,1,0,0,0,0],[1,1,0,1,1,0,1],[1,1,1,1,0,0,1],[0,1,1,0,0,1,1],[1,0,1,1,0,1,1],[1,0,1,1,1,1,1],[1,1,1,0,0,0,0],[1,1,1,1,1,1,1],[1,1,1,1,0,1,1]];
  function drawScore(score) {
    if (score === lastScore) return; lastScore = score;
    const canvas = dom['score-digits']; const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    const text = String(score).padStart(9, '0');
    const polygons = [[7,1,36,1,31,6,12,6],[37,2,37,23,32,19,32,8],[37,27,37,48,32,42,32,31],[7,49,36,49,31,44,12,44],[1,27,1,48,6,42,6,31],[1,2,1,23,6,19,6,8],[3,25,8,22,30,22,35,25,30,28,8,28]];
    for (let i = 0; i < text.length; i++) {
      const bits = segments[Number(text[i])]; c.save(); c.translate(i * 49 + 2, 2);
      for (let j = 0; j < polygons.length; j++) { c.beginPath(); const polygon = polygons[j]; for (let p = 0; p < polygon.length; p += 2) p ? c.lineTo(polygon[p], polygon[p + 1]) : c.moveTo(polygon[p], polygon[p + 1]); c.closePath(); c.fillStyle = bits[j] ? '#35f0f1' : '#143e4e'; c.fill(); }
      c.restore();
    }
    canvas.setAttribute('aria-label', `当前得分 ${score}`);
  }
  function updateUI() {
    const player = game.player;
    drawScore(player.score);
    dom['score-multiplier'].textContent = '×' + (game.beanValue(player) / 100).toFixed(2);
    dom['length-value'].textContent = String(player.length).padStart(3, '0');
    const remaining = Math.ceil(game.timeLeft);
    dom['time-value'].textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    dom['time-value'].parentElement.classList.toggle('urgent', remaining <= 15 && game.state === 'playing');
    dom['best-score'].textContent = String(best).padStart(8, '0');
    dom['kill-value'].textContent = String(player.kills).padStart(2, '0');
    dom['food-value'].textContent = String(player.foodCount).padStart(2, '0');
    const fuel = Math.max(0, player.length - CONFIG.minLength);
    const filled = Math.min(12, Math.ceil(fuel / 2));
    [...dom['boost-bars'].children].forEach((bar, i) => bar.classList.toggle('filled', i < filled));
    dom['boost-bars'].classList.toggle('active', player.boosting);
    dom['boost-state'].textContent = !player.alive ? '重组中' : player.boosting ? '爆冲中！' : fuel ? '就绪' : '长度不足';
    dom['boost-budget'].textContent = `可消耗 ${fuel} 节`;
    dom['respawn-banner'].hidden = player.alive || game.state !== 'playing';
    dom['respawn-count'].textContent = Math.max(1, Math.ceil(player.respawnIn));
    dom['screen-status'].textContent = player.invincible > 0 ? `INVINCIBLE / ${Math.ceil(player.invincible)}s` : player.boosting ? 'BOOST ACTIVE / MASS CONSUMING' : 'INSERT SKILL. NOT COINS.';
    const sorted = [...game.snakes].sort((a, b) => b.length - a.length);
    dom.rankings.innerHTML = sorted.map(s => `<div class="rank-row ${s.isPlayer ? 'is-player' : ''} ${s.alive ? '' : 'dead'}"><i class="rank-snake" style="--snake-color:${s.color}"></i><span class="rank-name">${s.name}<small>${!s.alive ? `重组中 ${Math.ceil(s.respawnIn)}s` : game.mode === 'team' ? s.team === 0 ? '我方 / FRIENDLY' : '敌方 / RIVAL' : s.isPlayer ? 'PLAYER 01' : s.aiIntent === 'intercept' ? '正在寻找拦截机会' : 'CPU / FORAGING'}</small></span><b>${String(s.length).padStart(2, '0')}</b></div>`).join('');
    if (game.mode === 'team') {
      const lengths = game.teamLengths();
      dom['team-totals'].innerHTML = `<span style="color:#39d5f2">我方 ${lengths[0]}</span><span style="color:#d77bff">对方 ${lengths[1]}</span>`;
    }
  }

  dom['start-button'].addEventListener('click', startOrResume);
  dom['pause-button'].addEventListener('click', pause);
  dom['overlay-secondary'].addEventListener('click', () => game.state === 'paused' ? reset(game.mode) : openHelp());
  document.querySelectorAll('.mode-button').forEach(button => button.addEventListener('click', () => { if (button.dataset.mode !== game.mode) reset(button.dataset.mode); }));
  dom['match-label'].addEventListener('click', () => reset(game.mode === 'team' ? 'classic' : 'team'));
  const controls = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  document.addEventListener('keydown', event => {
    if (dom['help-dialog'].open) return;
    const code = event.code;
    if (code in controls || ['Space', 'KeyJ', 'Escape', 'KeyP', 'Enter', 'KeyR'].includes(code)) event.preventDefault();
    if (code in controls && game.state === 'playing') { game.player.turn(controls[code]); audio.unlock(); }
    if (code === 'Space' || code === 'KeyJ') setBoost(code, true);
    if (!event.repeat && (code === 'Escape' || code === 'KeyP')) pause();
    if (!event.repeat && code === 'Enter' && game.state !== 'playing') startOrResume();
    if (!event.repeat && code === 'KeyR') { reset(game.mode); startOrResume(); }
  });
  document.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'KeyJ') setBoost(event.code, false); });
  window.addEventListener('blur', () => { releaseBoost(); if (game.state === 'playing') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'playing') pause(); });

  function updateSoundButton() {
    dom['sound-button'].setAttribute('aria-pressed', String(audio.enabled));
    dom['sound-button'].setAttribute('aria-label', audio.enabled ? '关闭音效' : '开启音效');
    dom['sound-button'].title = audio.enabled ? '关闭音效' : '开启音效';
    dom['sound-button'].innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z${audio.enabled ? 'm4 3c4 3 4 5 0 8m3-11c6 5 6 9 0 14' : 'm5 4 5 6m0-6-5 6'}"/></svg>`;
  }
  dom['sound-button'].addEventListener('click', () => { audio.enabled = !audio.enabled; storage.set('sound', audio.enabled ? 'on' : 'off'); audio.unlock(); audio.play('pickup'); updateSoundButton(); });
  $('fullscreen-button').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.querySelector('.game-column').requestFullscreen) await document.querySelector('.game-column').requestFullscreen();
      else toast('当前浏览器暂不支持全屏');
    } catch { toast('全屏暂不可用，可使用浏览器全屏模式'); }
  });
  function openHelp() {
    helpPaused = game.state === 'playing';
    if (helpPaused) pause();
    releaseBoost(); dom['help-dialog'].showModal();
  }
  function closeHelp() { dom['help-dialog'].close(); }
  dom['help-dialog'].addEventListener('close', () => { if (helpPaused && game.state === 'paused') pause(); helpPaused = false; dom.game.focus({ preventScroll: true }); });
  $('help-button').addEventListener('click', openHelp);
  $('close-help').addEventListener('click', closeHelp);
  $('understood-button').addEventListener('click', closeHelp);
  dom['help-dialog'].addEventListener('click', event => { if (event.target === dom['help-dialog']) { const r = dom['help-dialog'].getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeHelp(); } });

  const joystick = $('joystick'), knob = $('joystick-knob');
  let joyPointer = null;
  function moveJoystick(event) {
    const r = joystick.getBoundingClientRect(); let dx = event.clientX - r.left - r.width / 2, dy = event.clientY - r.top - r.height / 2;
    const length = Math.hypot(dx, dy), travel = Math.min(r.width, r.height) * .23;
    if (length > travel) { dx *= travel / length; dy *= travel / length; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (length > Math.min(14, r.width * .075) && game.state === 'playing') game.player.turn(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 2 : 0);
  }
  joystick.addEventListener('pointerdown', event => { if (joyPointer !== null) return; event.preventDefault(); joyPointer = event.pointerId; joystick.setPointerCapture(event.pointerId); moveJoystick(event); });
  joystick.addEventListener('pointermove', event => { if (event.pointerId === joyPointer) moveJoystick(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(name, event => { if (event.pointerId === joyPointer) { joyPointer = null; knob.style.transform = ''; } });
  window.addEventListener('resize', () => { releaseBoost(); joyPointer = null; knob.style.transform = ''; });
  dom['touch-boost'].addEventListener('pointerdown', event => { event.preventDefault(); dom['touch-boost'].setPointerCapture(event.pointerId); setBoost('touch:' + event.pointerId, true); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) dom['touch-boost'].addEventListener(name, event => setBoost('touch:' + event.pointerId, false));
  let swipe = null;
  dom.game.addEventListener('pointerdown', event => { swipe = { x: event.clientX, y: event.clientY, id: event.pointerId }; dom.game.setPointerCapture(event.pointerId); });
  dom.game.addEventListener('pointermove', event => {
    if (!swipe || swipe.id !== event.pointerId || game.state !== 'playing') return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) > 12) { game.player.turn(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 2 : 0); swipe = { x: event.clientX, y: event.clientY, id: event.pointerId }; }
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) dom.game.addEventListener(name, () => { swipe = null; });
  updateSoundButton(); showOverlay('ready'); updateUI();
  let previous = performance.now();
  function frame(now) {
    const dt = Math.min((now - previous) / 1000, .1); previous = now;
    game.update(dt); renderer.draw(now / 1000, dt);
    uiClock += dt;
    if (uiClock > .075) { uiClock = 0; updateUI(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Read-only inspection hook for local QA and Canvas capture tools.
  window.snakeDuel = { get state() { return game.state; }, get mode() { return game.mode; }, snapshot() { return { state: game.state, time: game.timeLeft, score: game.player.score, length: game.player.length, alive: game.player.alive, boosting: game.player.boosting, snakes: game.snakes.map(s => ({ id: s.id, alive: s.alive, length: s.length, score: s.score })) }; } };
})();
