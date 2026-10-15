(function () {
  'use strict';
  const { CONFIG } = window.SnakeDuel;
  const S = CONFIG.cell;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.game = game;
      this.particles = [];
      this.labels = [];
      this.rings = [];
      this.shake = 0;
      this.boostParticleClock = 0;
      this.background = document.createElement('canvas');
      this.background.width = canvas.width;
      this.background.height = canvas.height;
      this.makeBackground();
    }
    makeBackground() {
      const c = this.background.getContext('2d');
      const gradient = c.createRadialGradient(480, 320, 25, 480, 320, 650);
      gradient.addColorStop(0, '#36d3d6');
      gradient.addColorStop(0.48, '#13b9c9');
      gradient.addColorStop(1, '#0790ad');
      c.fillStyle = gradient;
      c.fillRect(0, 0, 960, 680);
      for (let y = 0; y < CONFIG.rows; y++) for (let x = 0; x < CONFIG.cols; x++) {
        c.beginPath();
        c.roundRect(x * S + 0.7, y * S + 0.7, S - 1.4, S - 1.4, 4);
        c.strokeStyle = 'rgba(173, 255, 255, .25)';
        c.lineWidth = 1;
        c.stroke();
        if ((x + y) % 2 === 0) {
          c.fillStyle = '#073e4b05';
          c.fill();
        }
      }
      c.strokeStyle = '#afffff50';
      c.strokeRect(1, 1, 958, 678);
    }
    event(event) {
      if (event.type === 'reset') { this.particles = []; this.labels = []; this.rings = []; }
      if (event.type === 'pickup') {
        const color = event.food.type === 'star' ? '#fff297' : event.food.type === 'diamond' ? '#afffcc' : '#fff4b2';
        this.burst(event.food.x, event.food.y, color, event.food.type === 'bean' ? 7 : 20);
        if (event.snake.isPlayer) this.labels.push({ x: (event.food.x + .5) * S, y: event.food.y * S, text: `+${event.points.toLocaleString()}`, life: .85, maxLife: .85, color });
        if (event.food.type === 'star') this.rings.push({ x: (event.food.x + .5) * S, y: (event.food.y + .5) * S, life: .7, maxLife: .7, color: '#fff29c' });
      }
      if (event.type === 'death') {
        for (let i = 0; i < event.body.length; i += Math.max(1, Math.floor(event.body.length / 30))) this.burst(event.body[i].x, event.body[i].y, event.snake.color, 4);
        if (event.snake.isPlayer && !reducedMotion) this.shake = .28;
        const head = event.body[0];
        this.rings.push({ x: (head.x + .5) * S, y: (head.y + .5) * S, life: .6, maxLife: .6, color: event.snake.color });
      }
      if (event.type === 'respawn') this.rings.push({ x: (event.snake.head.x + .5) * S, y: (event.snake.head.y + .5) * S, life: .8, maxLife: .8, color: '#e4ffff' });
      if (event.type === 'boostCost') this.burst(event.position.x, event.position.y, event.snake.color, 3);
      if (event.type === 'hazardDestroyed') this.burst(event.position.x, event.position.y, '#ffee98', 25);
    }
    burst(x, y, color, count) {
      if (reducedMotion) count = Math.min(count, 3);
      for (let i = 0; i < count && this.particles.length < 600; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 35 + Math.random() * 110;
        const life = .2 + Math.random() * .55;
        this.particles.push({ x: (x + .5) * S, y: (y + .5) * S, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color, size: 2 + Math.random() * 4 });
      }
    }
    draw(now, dt) {
      const c = this.ctx;
      const game = this.game;
      const active = game.state === 'playing';
      c.save();
      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - dt);
        c.translate((Math.random() - .5) * this.shake * 18, (Math.random() - .5) * this.shake * 18);
      }
      c.drawImage(this.background, 0, 0);
      if (!reducedMotion) {
        const scan = (now * 23) % 900 - 110;
        const glow = c.createLinearGradient(0, scan, 0, scan + 110);
        glow.addColorStop(0, '#9affff00'); glow.addColorStop(.8, '#a8ffff06'); glow.addColorStop(1, '#c4ffff00');
        c.fillStyle = glow; c.fillRect(0, scan, 960, 110);
      }
      for (const obstacle of game.obstacles) this.drawObstacle(obstacle, now);
      for (const food of game.foods) this.drawFood(food, now);
      for (const mine of game.mines) this.drawMine(mine, now);
      for (const snake of [...game.snakes].reverse()) if (snake.alive) this.drawSnake(snake, now);
      this.drawEffects(dt, active);
      c.restore();
      if (active && !reducedMotion) {
        this.boostParticleClock += dt;
        if (this.boostParticleClock > .025) {
          this.boostParticleClock = 0;
          for (const s of game.snakes) if (s.alive && s.boosting) {
            const head = this.renderHead(s);
            const d = window.SnakeDuel.DIRS[s.direction];
            const life = .15 + Math.random() * .15;
            this.particles.push({ x: head.x * S + S / 2 + (Math.random() - .5) * 15, y: head.y * S + S / 2 + (Math.random() - .5) * 15, vx: -d.x * 170, vy: -d.y * 170, color: '#fff3b2', size: 3, life, maxLife: life });
          }
        }
      }
    }
    drawObstacle(o, now) {
      const c = this.ctx;
      const x = o.x * S + 1, y = o.y * S + 1, w = o.width * S - 2, h = o.height * S - 2;
      c.save();
      if (o.warning > 0) c.globalAlpha = .25 + Math.sin(now * 12) * .15;
      c.fillStyle = '#253f67'; c.fillRect(x, y + 3, w, h);
      c.fillStyle = '#375a82'; c.fillRect(x, y, w, h);
      c.strokeStyle = '#9ad4dc'; c.lineWidth = 1.5; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
      c.strokeStyle = '#a4c3bb'; c.lineWidth = 3;
      c.beginPath();
      for (let i = 8; i < w - 5; i += 14) { c.moveTo(x + i - 3, y + h / 2 - 5); c.lineTo(x + i + 2, y + h / 2); c.lineTo(x + i - 3, y + h / 2 + 5); }
      c.stroke(); c.restore();
    }
    drawFood(food, now) {
      const c = this.ctx;
      const x = (food.x + .5) * S, y = (food.y + .5) * S;
      c.save();
      if (food.ttl && food.ttl - food.age < 3) c.globalAlpha = .45 + Math.sin(now * 13) * .4;
      c.translate(x, y);
      if (food.type === 'star') {
        c.rotate(reducedMotion ? 0 : Math.sin(now * 2) * .1);
        c.shadowColor = '#fff66e'; c.shadowBlur = 16;
        c.beginPath();
        for (let i = 0; i < 10; i++) { const angle = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? 6 : 13; if (!i) c.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius); else c.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); }
        c.closePath(); c.fillStyle = '#ffe944'; c.strokeStyle = '#8a701a'; c.lineWidth = 2; c.fill(); c.stroke();
        c.shadowBlur = 0; c.fillStyle = '#fff9ba'; c.beginPath(); c.moveTo(0, -10); c.lineTo(0, 1); c.lineTo(-7, 4); c.closePath(); c.fill();
      } else if (food.type === 'diamond') {
        c.shadowColor = '#79ffba'; c.shadowBlur = 12;
        c.fillStyle = '#33ef96'; c.strokeStyle = '#076e72'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(-8, -8, 16, 16, 2); c.fill(); c.stroke();
        c.shadowBlur = 0; c.fillStyle = '#b3ffd1'; c.beginPath(); c.moveTo(-6, -6); c.lineTo(6, -6); c.lineTo(-6, 5); c.closePath(); c.fill();
        c.strokeStyle = '#fff7b8'; c.lineWidth = 1; c.beginPath(); c.moveTo(10, -14); c.lineTo(10, -8); c.moveTo(7, -11); c.lineTo(13, -11); c.stroke();
      } else {
        const r = food.type === 'scrap' ? 4.7 : 6.3;
        c.shadowColor = '#fff4ab'; c.shadowBlur = food.type === 'scrap' ? 7 : 10;
        c.beginPath(); c.moveTo(0, -r - 2); c.lineTo(r, 0); c.lineTo(0, r + 2); c.lineTo(-r, 0); c.closePath();
        c.fillStyle = food.type === 'scrap' ? '#fff0a0' : '#ffdb5b'; c.strokeStyle = '#9a713d'; c.lineWidth = 1.5; c.fill(); c.stroke();
        c.shadowBlur = 0; c.fillStyle = '#fff9d4'; c.beginPath(); c.moveTo(0, -r); c.lineTo(0, r - 1); c.lineTo(-r + 2, 0); c.closePath(); c.fill();
      }
      c.restore();
    }
    drawMine(m, now) {
      const c = this.ctx;
      c.save();
      const t = clamp(m.clock / .6, 0, 1);
      const x = (lerp(m.previous.x, m.x, t) + .5) * S, y = (lerp(m.previous.y, m.y, t) + .5) * S;
      c.translate(x, y);
      if (m.warning > 0) {
        c.globalAlpha = .4 + Math.sin(now * 9) * .3;
        c.strokeStyle = '#fff198'; c.lineWidth = 2; c.setLineDash([3, 3]); c.beginPath(); c.arc(0, 0, 21, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
      c.rotate(reducedMotion ? 0 : now * .7);
      c.fillStyle = '#d74668'; c.strokeStyle = '#50204d'; c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; const r = i % 2 ? 8 : 12; if (!i) c.moveTo(r, 0); else c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#371d43'; c.beginPath(); c.arc(0, 0, 5.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = Math.sin(now * 7) > 0 ? '#fff2c6' : '#ff7174'; c.fillRect(-2, -2, 4, 4); c.restore();
    }
    renderHead(snake) {
      const t = this.game.state === 'ready' ? 1 : clamp(snake.moveClock / snake.stepDuration, 0, 1);
      return { x: lerp(snake.previousHead.x, snake.head.x, t), y: lerp(snake.previousHead.y, snake.head.y, t) };
    }
    drawSnake(snake, now) {
      const c = this.ctx;
      const head = this.renderHead(snake);
      const body = [head, ...snake.body.slice(1)];
      if (body.length < 2) return;
      const points = body.map(p => ({ x: (p.x + .5) * S, y: (p.y + .5) * S }));
      c.save();
      if (snake.shield > 0 && this.game.state !== 'ready') c.globalAlpha = .65 + Math.sin(now * 18) * .28;
      c.lineJoin = 'miter'; c.lineCap = 'square';
      const trace = () => { c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); };
      trace(); c.strokeStyle = '#233659'; c.lineWidth = S + 2; c.stroke();
      if (snake.boosting) { c.shadowColor = '#ffef8c'; c.shadowBlur = 18; }
      trace(); c.strokeStyle = snake.color; c.lineWidth = S - 2; c.stroke(); c.shadowBlur = 0;
      if (snake.invincible > 0) {
        c.lineWidth = S - 3;
        for (let i = points.length - 1; i > 0; i--) { c.strokeStyle = `hsl(${(now * 210 + i * 24) % 360} 100% 65%)`; c.beginPath(); c.moveTo(points[i].x, points[i].y); c.lineTo(points[i - 1].x, points[i - 1].y); c.stroke(); }
      }
      // Thin bevel and occasional geometric tiles keep the reference's square silhouette.
      c.save(); c.translate(-2, -3); trace(); c.lineWidth = 2; c.strokeStyle = '#ffffff24'; c.stroke(); c.restore();
      const tailColors = snake.isPlayer ? ['#1559ee', '#ed1aaa', '#f039ea', '#be51ff', '#5fe2d8'] : [snake.color, '#b873ff', '#8b4fe9'];
      for (let j = 0; j < Math.min(tailColors.length, points.length - 3); j++) {
        const p = points[points.length - 1 - j];
        c.fillStyle = snake.invincible > 0 ? `hsl(${(now * 210 + j * 40) % 360} 100% 65%)` : tailColors[j];
        c.fillRect(p.x - S / 2 + 1, p.y - S / 2 + 1, S - 2, S - 2);
      }
      for (let i = 5; i < points.length - 5; i += 5) {
        c.strokeStyle = '#ffffff22'; c.lineWidth = 1; c.strokeRect(points[i].x - 5, points[i].y - 5, 10, 10);
      }
      const hx = (head.x + .5) * S, hy = (head.y + .5) * S;
      c.translate(hx, hy); c.rotate((snake.direction - 1) * Math.PI / 2);
      c.fillStyle = snake.invincible > 0 ? `hsl(${now * 210 % 360} 100% 65%)` : snake.color;
      c.fillRect(-9, -9, 18, 18);
      c.fillStyle = '#fff7cf'; c.beginPath(); c.roundRect(1, -6.5, 4, 4.5, 1); c.roundRect(1, 2, 4, 4.5, 1); c.fill();
      c.fillStyle = '#0c2c4e'; c.fillRect(3, -5, 2, 2); c.fillRect(3, 3.5, 2, 2);
      c.restore();
      if (snake.isPlayer && (this.game.elapsed < 6 || snake.shield > 0 || snake.invincible > 0)) {
        const label = snake.invincible > 0 ? `★ ${Math.ceil(snake.invincible)}s` : 'YOU';
        c.save(); c.font = 'bold 10px Consolas, monospace'; c.textAlign = 'center';
        c.fillStyle = '#143047d9'; c.fillRect(hx - 19, hy - 33, 38, 16);
        c.fillStyle = snake.invincible > 0 ? '#fff383' : '#e8fbff'; c.fillText(label, hx, hy - 21);
        c.beginPath(); c.moveTo(hx - 3, hy - 17); c.lineTo(hx + 3, hy - 17); c.lineTo(hx, hy - 13); c.fill(); c.restore();
      }
    }
    drawEffects(dt, active) {
      const c = this.ctx;
      for (const p of this.particles) {
        if (active) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .98; p.vy *= .98; }
        c.globalAlpha = Math.max(0, p.life / p.maxLife); c.fillStyle = p.color; c.fillRect(p.x, p.y, p.size, p.size);
      }
      for (const ring of this.rings) {
        if (active) ring.life -= dt;
        const progress = 1 - ring.life / ring.maxLife;
        c.globalAlpha = Math.max(0, 1 - progress); c.strokeStyle = ring.color; c.lineWidth = 3 - progress * 2;
        c.beginPath(); c.arc(ring.x, ring.y, 10 + progress * 65, 0, Math.PI * 2); c.stroke();
      }
      for (const label of this.labels) {
        if (active) { label.life -= dt; label.y -= dt * 30; }
        c.globalAlpha = Math.max(0, label.life / label.maxLife); c.font = 'bold 15px Consolas, monospace'; c.textAlign = 'center'; c.strokeStyle = '#213a52'; c.lineWidth = 3; c.strokeText(label.text, label.x, label.y); c.fillStyle = label.color; c.fillText(label.text, label.x, label.y);
      }
      c.globalAlpha = 1;
      this.particles = this.particles.filter(p => p.life > 0);
      this.rings = this.rings.filter(p => p.life > 0);
      this.labels = this.labels.filter(p => p.life > 0);
    }
  }
  window.SnakeDuel.Renderer = Renderer;
})();
