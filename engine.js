(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SnakeDuel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const CONFIG = Object.freeze({ cols: 48, rows: 34, cell: 20, baseStep: 0.115, boostStep: 0.051, boostCost: 0.28, minLength: 6, initialLength: 14, starDuration: 8 });
  const equal = (a, b) => a.x === b.x && a.y === b.y;
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const key = p => `${p.x},${p.y}`;
  const copy = p => ({ x: p.x, y: p.y });

  class Snake {
    constructor(id, name, color, team, isPlayer = false) {
      Object.assign(this, { id, name, color, team, isPlayer });
      this.score = 0;
      this.foodCount = 0;
      this.itemCount = 0;
      this.kills = 0;
      this.deaths = 0;
      this.maxLength = 0;
      this.alive = false;
      this.body = [];
      this.respawnIn = 0;
      this.aiTimer = 0;
      this.aiBoostTimer = 0;
      this.aiIntent = 'forage';
    }
    spawn(head, direction, length, shield = 1.5) {
      this.direction = direction;
      this.body = Array.from({ length }, (_, i) => ({ x: head.x - DIRS[direction].x * i, y: head.y - DIRS[direction].y * i }));
      this.previousHead = copy(head);
      this.previousTail = copy(this.body[this.body.length - 1]);
      this.targetLength = length;
      this.alive = true;
      this.boosting = false;
      this.boostRequested = false;
      this.boostClock = 0;
      this.moveClock = 0;
      this.stepDuration = CONFIG.baseStep;
      this.directionQueue = [];
      this.invincible = 0;
      this.shield = shield;
      this.respawnIn = 0;
      this.maxLength = Math.max(this.maxLength, length);
    }
    get head() { return this.body[0]; }
    get length() { return this.body.length; }
    get canBoost() { return this.alive && this.length > CONFIG.minLength; }
    turn(direction) {
      if (!this.alive || !Number.isInteger(direction) || direction < 0 || direction > 3) return;
      const last = this.directionQueue.length ? this.directionQueue[this.directionQueue.length - 1] : this.direction;
      if (direction !== last && direction !== (last + 2) % 4 && this.directionQueue.length < 2) this.directionQueue.push(direction);
    }
    addScore(amount) { this.score = Math.min(999999999, this.score + Math.round(amount)); }
    grow(amount) { this.targetLength = Math.min(500, this.targetLength + amount); }
  }

  class Game {
    constructor(options = {}) {
      this.random = options.random || Math.random;
      this.onEvent = options.onEvent || (() => {});
      this.mode = options.mode || 'classic';
      this.reset(this.mode);
    }
    emit(type, data = {}) { this.onEvent({ type, ...data }); }
    reset(mode = this.mode) {
      this.mode = mode;
      this.state = 'ready';
      this.timeLeft = mode === 'team' ? 45 : 180;
      this.elapsed = 0;
      this.foods = [];
      this.obstacles = [];
      this.mines = [];
      this.effects = [];
      this.pickupClock = 0;
      this.diamondClock = 7;
      this.starClock = mode === 'team' ? 18 : 25;
      this.hazardClock = 30;
      this.tickClock = 0;
      this.snakes = [
        new Snake('player', '你 / YOU', '#ff711b', 0, true),
        new Snake('violet', '紫电 / VIOLET', '#a83aff', 1),
        new Snake('byte', mode === 'team' ? '搭档 / BYTE' : '脉冲 / BYTE', '#168dff', mode === 'team' ? 0 : 2)
      ];
      if (mode === 'team') this.snakes.push(new Snake('pink', '霓虹 / NEON', '#f542ab', 1));
      this.player = this.snakes[0];
      const starts = [{ x: 15, y: 11, dir: 1 }, { x: 33, y: 23, dir: 3 }, { x: 28, y: 6, dir: 2 }, { x: 14, y: 27, dir: 1 }];
      this.snakes.forEach((snake, i) => {
        snake.spawn(starts[i], starts[i].dir, i === 0 ? CONFIG.initialLength : 11 + i * 2);
        // Opening shapes give every snake a clear lane and avoid a starting body overlap.
        if (i === 0) snake.body = this.makePath([{ x: 15, y: 11 }, { x: 8, y: 11 }, { x: 8, y: 15 }, { x: 10, y: 15 }]);
        if (i === 1) snake.body = this.makePath([{ x: 33, y: 23 }, { x: 40, y: 23 }, { x: 40, y: 28 }, { x: 39, y: 28 }]);
        if (i === 2) snake.body = this.makePath([{ x: 28, y: 6 }, { x: 28, y: 2 }, { x: 34, y: 2 }, { x: 34, y: 6 }]);
        if (i === 3) snake.body = this.makePath([{ x: 14, y: 27 }, { x: 7, y: 27 }, { x: 7, y: 30 }, { x: 13, y: 30 }]);
        snake.targetLength = snake.length;
        snake.maxLength = snake.length;
        snake.previousTail = copy(snake.body[snake.length - 1]);
      });
      for (const block of [{ x: 18, y: 21 }, { x: 34, y: 11 }, { x: 7, y: 4 }, { x: 40, y: 17 }]) {
        const cells = [{ x: block.x, y: block.y }, { x: block.x + 1, y: block.y }, { x: block.x, y: block.y + 1 }, { x: block.x + 1, y: block.y + 1 }];
        if (cells.every(p => this.isFree(p))) this.obstacles.push({ ...block, width: 2, height: 2, warning: 0 });
      }
      for (let i = 0; i < 50; i++) this.spawnFood('bean');
      this.spawnFood('diamond');
      this.spawnMine({ x: 22, y: 27 });
      this.spawnMine({ x: 40, y: 6 });
      this.emit('reset');
    }
    makePath(corners) {
      const result = [copy(corners[0])];
      for (let i = 1; i < corners.length; i++) {
        let p = copy(result[result.length - 1]);
        while (!equal(p, corners[i])) {
          p = { x: p.x + Math.sign(corners[i].x - p.x), y: p.y + Math.sign(corners[i].y - p.y) };
          result.push(p);
        }
      }
      return result;
    }
    start() { if (this.state === 'ready') { this.state = 'playing'; this.emit('start'); } }
    togglePause() {
      if (this.state === 'playing') { this.state = 'paused'; this.clearInput(); this.emit('pause'); }
      else if (this.state === 'paused') { this.state = 'playing'; this.emit('resume'); }
    }
    clearInput() { for (const s of this.snakes) s.boostRequested = s.boosting = false; }
    inBounds(p) { return p.x >= 0 && p.y >= 0 && p.x < CONFIG.cols && p.y < CONFIG.rows; }
    obstacleAt(p, activeOnly = true) {
      return this.obstacles.find(o => (!activeOnly || o.warning <= 0) && p.x >= o.x && p.x < o.x + o.width && p.y >= o.y && p.y < o.y + o.height);
    }
    isFree(p, clearance = 0, ignoreFood = false) {
      if (!this.inBounds(p) || p.x < 1 || p.y < 1 || p.x >= CONFIG.cols - 1 || p.y >= CONFIG.rows - 1) return false;
      if (this.obstacleAt(p, false)) return false;
      if (this.snakes.some(s => s.alive && s.body.some(b => distance(p, b) <= clearance))) return false;
      if (!ignoreFood && this.foods.some(f => equal(f, p))) return false;
      if (this.mines.some(m => distance(p, m) <= Math.max(2, clearance))) return false;
      return true;
    }
    randomFree(clearance = 0) {
      for (let tries = 0; tries < 350; tries++) {
        const p = { x: 2 + Math.floor(this.random() * (CONFIG.cols - 4)), y: 2 + Math.floor(this.random() * (CONFIG.rows - 4)) };
        if (this.isFree(p, clearance) && this.snakes.every(s => !s.alive || distance(p, s.head) >= 4)) return p;
      }
      for (let y = 2; y < CONFIG.rows - 2; y++) for (let x = 2; x < CONFIG.cols - 2; x++) if (this.isFree({ x, y }, clearance)) return { x, y };
      return null;
    }
    spawnFood(type, position, extra = {}) {
      const p = position || this.randomFree();
      if (!p || !this.inBounds(p) || this.obstacleAt(p, false) || this.foods.some(f => equal(p, f))) return null;
      const food = { ...p, type, age: 0, ttl: type === 'scrap' ? 22 : type === 'star' ? 16 : 0, phase: this.random() * Math.PI * 2, ...extra };
      this.foods.push(food);
      return food;
    }
    spawnMine(position) {
      const p = position && this.isFree(position, 3) ? position : this.randomFree(4);
      if (p) this.mines.push({ ...p, previous: copy(p), clock: 0, direction: Math.floor(this.random() * 4), warning: 2, age: 0 });
    }
    respawn(snake) {
      for (let tries = 0; tries < 120; tries++) {
        const direction = Math.floor(this.random() * 4);
        const length = snake.isPlayer ? 8 : 9;
        const p = { x: 9 + Math.floor(this.random() * 30), y: 9 + Math.floor(this.random() * 16) };
        const path = Array.from({ length: length + 5 }, (_, i) => ({ x: p.x + DIRS[direction].x * (5 - i), y: p.y + DIRS[direction].y * (5 - i) }));
        if (path.every(cell => this.isFree(cell, 1, true))) {
          snake.spawn(p, direction, length, 2);
          this.foods = this.foods.filter(f => !snake.body.some(b => equal(f, b)));
          this.emit('respawn', { snake });
          return true;
        }
      }
      snake.respawnIn = 0.25;
      return false;
    }
    update(dt) {
      if (this.state !== 'playing') return;
      // Fixed simulation slices keep collision results independent of frame rate.
      this.tickClock += Math.min(dt, 0.25);
      while (this.tickClock >= 1 / 120 && this.state === 'playing') {
        this.step(1 / 120);
        this.tickClock -= 1 / 120;
      }
    }
    step(dt) {
      this.elapsed += dt;
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0.00001) { this.finish(); return; }
      this.updateGenerators(dt);
      this.updateMines(dt);
      const movers = [];
      for (const snake of this.snakes) {
        if (!snake.alive) {
          snake.respawnIn -= dt;
          if (snake.respawnIn <= 0) this.respawn(snake);
          continue;
        }
        snake.invincible = Math.max(0, snake.invincible - dt);
        snake.shield = Math.max(0, snake.shield - dt);
        if (!snake.isPlayer) this.updateAI(snake, dt);
        snake.boosting = snake.boostRequested && snake.canBoost;
        if (snake.boosting) {
          snake.boostClock += dt;
          if (snake.boostClock >= CONFIG.boostCost) {
            snake.boostClock -= CONFIG.boostCost;
            if (snake.length > CONFIG.minLength) {
              const tail = snake.body.pop();
              snake.targetLength = Math.max(CONFIG.minLength, snake.targetLength - 1);
              if (this.random() < 0.7) this.spawnFood('scrap', tail, { ttl: 9 });
              this.emit('boostCost', { snake, position: tail });
            }
          }
        } else snake.boostClock = 0;
        snake.stepDuration = snake.boosting ? CONFIG.boostStep : CONFIG.baseStep;
        snake.moveClock += dt;
        if (snake.moveClock >= snake.stepDuration) {
          snake.moveClock -= snake.stepDuration;
          if (snake.directionQueue.length) snake.direction = snake.directionQueue.shift();
          movers.push(snake);
        }
      }
      if (movers.length) this.moveSnakes(movers);
      // A moving mine can hit a stationary head between two snake steps.
      for (const snake of this.snakes) if (snake.alive && snake.invincible <= 0 && snake.shield <= 0 && this.mines.some(m => m.warning <= 0 && equal(m, snake.head))) this.kill(snake, null, 'mine');
    }
    moveSnakes(movers) {
      const proposals = new Map();
      for (const s of movers) proposals.set(s, { x: s.head.x + DIRS[s.direction].x, y: s.head.y + DIRS[s.direction].y });
      const deaths = new Map();
      const blocked = new Set();
      const contacts = new Map();
      for (const s of movers) {
        let next = proposals.get(s);
        if (!this.inBounds(next)) {
          if (s.invincible > 0) {
            s.direction = (s.direction + 2) % 4;
            s.directionQueue = [];
            next = { x: s.head.x + DIRS[s.direction].x, y: s.head.y + DIRS[s.direction].y };
            proposals.set(s, next);
          } else { deaths.set(s, { killer: null, reason: 'wall' }); continue; }
        }
        const obstacle = this.obstacleAt(next);
        const mine = this.mines.find(m => m.warning <= 0 && equal(m, next));
        if (obstacle || mine) {
          if (s.invincible > 0) {
            if (obstacle) this.obstacles.splice(this.obstacles.indexOf(obstacle), 1);
            if (mine) this.mines.splice(this.mines.indexOf(mine), 1);
            s.addScore(500);
            this.emit('hazardDestroyed', { snake: s, position: next });
          } else if (s.shield <= 0) deaths.set(s, { killer: null, reason: obstacle ? 'obstacle' : 'mine' });
        }
      }
      // Resolve each pair once, including a boosted head hitting a head between steps.
      const alive = this.snakes.filter(s => s.alive);
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        if (a.team === b.team || deaths.has(a) || deaths.has(b)) continue;
        const nextA = proposals.get(a), nextB = proposals.get(b);
        const shared = nextA && nextB && equal(nextA, nextB);
        const swap = nextA && nextB && equal(nextA, b.head) && equal(nextB, a.head);
        const stationary = (nextA && !nextB && equal(nextA, b.head)) || (nextB && !nextA && equal(nextB, a.head));
        if (!shared && !swap && !stationary) continue;
        if (!contacts.has(a)) contacts.set(a, new Set());
        if (!contacts.has(b)) contacts.set(b, new Set());
        contacts.get(a).add(b); contacts.get(b).add(a);
        if (a.invincible > 0 || b.invincible > 0) {
          if (a.invincible > 0 && b.invincible <= 0 && b.shield <= 0) deaths.set(b, { killer: a, reason: 'star' });
          if (b.invincible > 0 && a.invincible <= 0 && a.shield <= 0) deaths.set(a, { killer: b, reason: 'star' });
        } else {
          blocked.add(a); blocked.add(b);
        }
      }
      for (const s of movers) {
        if (deaths.has(s) || blocked.has(s)) continue;
        const next = proposals.get(s);
        for (const other of this.snakes) {
          if (!other.alive || other === s || other.team === s.team) continue;
          if (contacts.get(s)?.has(other)) continue;
          const hitsBody = other.body.some(p => equal(next, p));
          if (!hitsBody) continue;
          if (s.invincible > 0 && other.invincible <= 0 && other.shield <= 0) deaths.set(other, { killer: s, reason: 'star' });
          else if (s.invincible <= 0 && s.shield <= 0) deaths.set(s, { killer: other, reason: 'body' });
        }
      }
      // Heads push against each other and lose one tail segment per movement beat.
      // Collision damage can exhaust a snake below the boost threshold of six.
      for (const s of blocked) {
        s.previousHead = copy(s.head);
        s.previousTail = copy(s.body[s.length - 1]);
        if (s.shield > 0 || deaths.has(s)) continue;
        if (s.length <= 1) deaths.set(s, { killer: null, reason: 'head' });
        else {
          const tail = s.body.pop();
          s.targetLength = s.length;
          s.previousTail = copy(s.body[s.length - 1]);
          if (!s.canBoost) s.boosting = false;
          this.emit('headClash', { snake: s, position: copy(s.head), tail, lost: 1 });
        }
      }
      // Commit movement only after all collisions have used the same snapshot.
      for (const [s, p] of proposals) {
        if (deaths.has(s) || blocked.has(s)) continue;
        s.previousHead = copy(s.head);
        s.previousTail = copy(s.body[s.length - 1]);
        s.body.unshift(p);
        if (s.body.length > s.targetLength) s.body.pop();
        s.maxLength = Math.max(s.maxLength, s.length);
      }
      for (const [s, death] of deaths) this.kill(s, death.killer, death.reason);
      for (const s of movers) if (s.alive && !blocked.has(s)) this.collect(s);
    }
    collect(snake) {
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const food = this.foods[i];
        if (!equal(food, snake.head)) continue;
        this.foods.splice(i, 1);
        let points;
        if (food.type === 'diamond') {
          points = this.beanValue(snake) * 12;
          snake.grow(5);
          snake.itemCount++;
        } else if (food.type === 'star') {
          points = this.beanValue(snake) * 20;
          snake.grow(2);
          snake.invincible = CONFIG.starDuration;
          snake.itemCount++;
        } else {
          points = this.beanValue(snake) * (food.type === 'scrap' ? 0.6 : 1);
          snake.grow(1);
          snake.foodCount++;
        }
        snake.addScore(points);
        this.emit('pickup', { snake, food, points: Math.round(points) });
      }
    }
    beanValue(snake) { return Math.min(100000, Math.round(100 * Math.pow(1.1, snake.foodCount))); }
    kill(snake, killer, reason) {
      if (!snake.alive) return;
      const body = snake.body.map(copy);
      snake.alive = false;
      snake.deaths++;
      snake.boosting = snake.boostRequested = false;
      snake.respawnIn = this.mode === 'team' ? 5 : 3;
      if (killer && killer !== snake) {
        killer.kills++;
        killer.addScore(1000 + body.length * 150);
      }
      for (const p of body) this.spawnFood('scrap', p);
      snake.body = [];
      snake.targetLength = 0;
      this.emit('death', { snake, killer, reason, body });
    }
    updateGenerators(dt) {
      for (const food of this.foods) food.age += dt;
      this.foods = this.foods.filter(f => !f.ttl || f.age < f.ttl);
      for (const o of this.obstacles) o.warning = Math.max(0, o.warning - dt);
      this.pickupClock -= dt;
      if (this.pickupClock <= 0) {
        this.pickupClock = 0.25;
        if (this.foods.filter(f => f.type === 'bean').length < 50) this.spawnFood('bean');
      }
      this.diamondClock -= dt;
      if (this.diamondClock <= 0) {
        this.diamondClock = 7 + this.random() * 6;
        if (this.foods.filter(f => f.type === 'diamond').length < 3) this.spawnFood('diamond');
      }
      this.starClock -= dt;
      if (this.starClock <= 0) {
        this.starClock = 25 + this.random() * 18;
        if (!this.foods.some(f => f.type === 'star')) { this.spawnFood('star'); this.emit('starSpawn'); }
      }
      this.hazardClock -= dt;
      if (this.hazardClock <= 0) {
        this.hazardClock = 28;
        if (this.mines.length < 5) this.spawnMine();
        const p = this.randomFree(4);
        if (p && this.obstacles.length < 7 && this.isFree({ x: p.x + 1, y: p.y }, 3)) this.obstacles.push({ ...p, width: 2, height: 1, warning: 3 });
        this.emit('hazardSpawn');
      }
    }
    updateMines(dt) {
      for (const m of this.mines) {
        m.age += dt;
        m.warning = Math.max(0, m.warning - dt);
        if (m.warning > 0) continue;
        m.clock += dt;
        if (m.clock < 0.6) continue;
        m.clock -= 0.6;
        m.previous = copy(m);
        const choices = [m.direction, (m.direction + 1) % 4, (m.direction + 3) % 4, (m.direction + 2) % 4];
        if (this.random() < 0.3) choices.unshift(Math.floor(this.random() * 4));
        for (const dir of choices) {
          const next = { x: m.x + DIRS[dir].x, y: m.y + DIRS[dir].y };
          if (this.inBounds(next) && next.x > 1 && next.y > 1 && next.x < CONFIG.cols - 2 && next.y < CONFIG.rows - 2 && !this.obstacleAt(next, false) && !this.mines.some(other => other !== m && equal(other, next)) && !this.snakes.some(s => s.alive && s.shield > 0 && distance(s.head, next) < 3)) {
            Object.assign(m, next, { direction: dir }); break;
          }
        }
      }
    }
    updateAI(snake, dt) {
      snake.aiTimer -= dt;
      snake.aiBoostTimer = Math.max(0, snake.aiBoostTimer - dt);
      if (snake.aiTimer > 0) return;
      snake.aiTimer = 0.085 + this.random() * 0.055;
      const opponents = this.snakes.filter(s => s.alive && s.team !== snake.team);
      const blocked = new Set();
      for (const other of opponents) if (snake.invincible <= 0 || other.invincible > 0) for (const b of other.body) blocked.add(key(b));
      const safe = p => this.inBounds(p) && !this.obstacleAt(p, false) && !blocked.has(key(p)) && !this.mines.some(m => m.warning <= 0 && distance(m, p) <= 1);
      const victim = this.player.alive && this.player.team !== snake.team ? this.player : opponents[0];
      const attack = victim && snake.length > 12 && distance(snake.head, victim.head) < 13 && Math.sin(this.elapsed * 0.32 + snake.id.length) > -0.15;
      let target = null;
      if (attack) {
        target = { x: victim.head.x + DIRS[victim.direction].x * 4, y: victim.head.y + DIRS[victim.direction].y * 4 };
        snake.aiIntent = 'intercept';
      } else {
        let min = Infinity;
        for (const food of this.foods) {
          const attraction = food.type === 'star' ? 6 : food.type === 'diamond' ? 3.5 : 0;
          const score = distance(snake.head, food) - attraction;
          if (score < min) { min = score; target = food; }
        }
        snake.aiIntent = 'forage';
      }
      let bestDirection = snake.direction;
      let bestScore = -Infinity;
      let bestLane = 0;
      for (let dir = 0; dir < 4; dir++) {
        if (dir === (snake.direction + 2) % 4) continue;
        const d = DIRS[dir];
        const next = { x: snake.head.x + d.x, y: snake.head.y + d.y };
        if (!safe(next)) continue;
        let lane = 0;
        for (let n = 1; n <= 7; n++) { if (!safe({ x: snake.head.x + d.x * n, y: snake.head.y + d.y * n })) break; lane++; }
        let score = lane * 1.2 + (target ? -distance(next, target) * 1.7 : 0) + (dir === snake.direction ? 0.55 : 0) + this.random() * 0.45;
        // A small flood fill rejects corridors and pockets before the head enters them.
        const visited = new Set([key(next)]);
        const frontier = [next];
        for (let n = 0; n < frontier.length && visited.size < 60; n++) for (const v of DIRS) {
          const p = { x: frontier[n].x + v.x, y: frontier[n].y + v.y };
          if (!visited.has(key(p)) && safe(p)) { visited.add(key(p)); frontier.push(p); }
        }
        score += Math.min(60, visited.size) * 0.22;
        if (visited.size < 12) score -= 25;
        for (const other of opponents) {
          const future = { x: other.head.x + DIRS[other.direction].x * 2, y: other.head.y + DIRS[other.direction].y * 2 };
          if (distance(next, future) <= 2 && snake.invincible <= 0) score -= 14;
          if (other.invincible > 0 && distance(next, other.head) < 7) score -= 22;
        }
        if (score > bestScore) { bestScore = score; bestDirection = dir; bestLane = lane; }
      }
      snake.directionQueue = [];
      snake.turn(bestDirection);
      if (bestLane >= 6 && snake.length > 12 && (attack || snake.invincible > 0 || this.random() < 0.04)) snake.aiBoostTimer = 0.5;
      snake.boostRequested = snake.aiBoostTimer > 0 && bestLane >= 5 && snake.canBoost;
    }
    teamLengths() {
      const totals = [0, 0];
      for (const s of this.snakes) if (s.alive && s.team < 2) totals[s.team] += s.length;
      return totals;
    }
    finish() {
      this.timeLeft = 0;
      this.state = 'finished';
      this.clearInput();
      const totals = this.teamLengths();
      this.result = { score: this.player.score, kills: this.player.kills, maxLength: this.player.maxLength, food: this.player.foodCount, teamLengths: totals, winner: totals[0] === totals[1] ? -1 : totals[0] > totals[1] ? 0 : 1 };
      this.emit('finish', { result: this.result });
    }
  }
  return { Game, Snake, CONFIG, DIRS, equal, distance };
});
