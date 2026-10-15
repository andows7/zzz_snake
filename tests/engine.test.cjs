const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game, Snake, CONFIG, equal } = require('../engine.js');

function seeded(seed = 42) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function arena(mode = 'classic') {
  const events = [];
  const game = new Game({ mode, random: seeded(), onEvent: e => events.push(e) });
  game.foods = []; game.obstacles = []; game.mines = [];
  game.pickupClock = game.diamondClock = game.starClock = game.hazardClock = Infinity;
  game.snakes = game.snakes.slice(0, 2);
  game.player.spawn({ x: 12, y: 12 }, 1, 10, 0);
  game.snakes[1].spawn({ x: 33, y: 25 }, 3, 10, 0);
  game.updateAI = () => {};
  game.start();
  return { game, player: game.player, enemy: game.snakes[1], events };
}
function advance(game, seconds) { for (let t = 0; t < seconds; t += 1 / 120) game.update(1 / 120); }

test('opening formations, food and obstacles never overlap, in either mode', () => {
  for (const mode of ['classic', 'team']) for (let seed = 1; seed <= 20; seed++) {
    const game = new Game({ mode, random: seeded(seed) });
    const occupied = new Set();
    for (const snake of game.snakes) for (const p of snake.body) {
      assert.ok(game.inBounds(p));
      assert.ok(!occupied.has(`${p.x},${p.y}`), 'starting snakes overlap');
      occupied.add(`${p.x},${p.y}`);
      assert.ok(!game.obstacleAt(p));
    }
    const foodCells = new Set();
    for (const food of game.foods) {
      assert.ok(!occupied.has(`${food.x},${food.y}`));
      assert.ok(!game.obstacleAt(food));
      assert.ok(!foodCells.has(`${food.x},${food.y}`));
      foodCells.add(`${food.x},${food.y}`);
      assert.ok(game.mines.every(m => !equal(m, food)));
    }
  }
});

test('direction buffering preserves quick corners and rejects reverse input', () => {
  const { game, player } = arena();
  player.turn(3); assert.deepEqual(player.directionQueue, []);
  player.turn(0); player.turn(3);
  game.moveSnakes([]);
  advance(game, CONFIG.baseStep + .005);
  assert.deepEqual(player.head, { x: 12, y: 11 });
  advance(game, CONFIG.baseStep);
  assert.deepEqual(player.head, { x: 11, y: 11 });
});

test('the player can cross its own body', () => {
  const { game, player } = arena();
  player.body = [{ x: 12, y: 12 }, { x: 12, y: 13 }, { x: 13, y: 13 }, { x: 13, y: 12 }, { x: 14, y: 12 }];
  player.targetLength = 5;
  game.moveSnakes([player]);
  assert.ok(player.alive);
  assert.deepEqual(player.head, { x: 13, y: 12 });
});

test('enemy body interception gives kill credit, drops beans and preserves victim score', () => {
  const { game, player, enemy, events } = arena();
  enemy.spawn({ x: 13, y: 10 }, 0, 8, 0); enemy.score = 1234;
  game.moveSnakes([player]);
  assert.equal(player.alive, false);
  assert.equal(enemy.kills, 1);
  assert.equal(game.foods.filter(f => f.type === 'scrap').length, 10);
  assert.equal(player.respawnIn, 3);
  assert.equal(events.find(e => e.type === 'death').reason, 'body');
  assert.equal(enemy.score, 1234 + 1000 + 10 * 150);
});

test('simultaneous head-on collision kills both regardless of iteration order', () => {
  for (const reversed of [false, true]) {
    const { game, player, enemy } = arena();
    enemy.spawn({ x: 14, y: 12 }, 3, 8, 0);
    game.moveSnakes(reversed ? [enemy, player] : [player, enemy]);
    assert.equal(player.alive, false); assert.equal(enemy.alive, false);
  }
});

test('head swaps cannot tunnel through an opponent while boosting', () => {
  const { game, player, enemy } = arena();
  enemy.spawn({ x: 13, y: 12 }, 3, 8, 0);
  game.moveSnakes([player, enemy]);
  assert.equal(player.alive, false); assert.equal(enemy.alive, false);
});

test('a star lets the head destroy an enemy body and survive', () => {
  const { game, player, enemy } = arena();
  enemy.spawn({ x: 13, y: 10 }, 0, 8, 0);
  player.invincible = 8;
  game.moveSnakes([player]);
  assert.ok(player.alive); assert.equal(enemy.alive, false); assert.equal(player.kills, 1);
});

test('walls kill normally, but stars reflect direction', () => {
  for (const star of [false, true]) {
    const { game, player } = arena();
    player.spawn({ x: 47, y: 12 }, 1, 8, 0);
    player.invincible = star ? 8 : 0;
    game.moveSnakes([player]);
    assert.equal(player.alive, star);
    if (star) { assert.equal(player.direction, 3); assert.equal(player.head.x, 46); }
  }
});

test('obstacles and active mines kill, stars destroy them', () => {
  for (const kind of ['obstacle', 'mine']) for (const star of [false, true]) {
    const { game, player } = arena();
    if (kind === 'obstacle') game.obstacles.push({ x: 13, y: 12, width: 1, height: 1, warning: 0 });
    else game.mines.push({ x: 13, y: 12, warning: 0 });
    player.invincible = star ? 8 : 0;
    game.moveSnakes([player]);
    assert.equal(player.alive, star);
    if (star) assert.equal(kind === 'obstacle' ? game.obstacles.length : game.mines.length, 0);
  }
});

test('boost burns one real segment every 0.28s and stops at length six', () => {
  const { game, player } = arena();
  game.moveSnakes = () => {};
  player.boostRequested = true;
  advance(game, .29);
  assert.equal(player.length, 9);
  advance(game, 2);
  assert.equal(player.length, CONFIG.minLength);
  assert.equal(player.targetLength, CONFIG.minLength);
  assert.equal(player.boosting, false);
  assert.equal(player.canBoost, false);
});

test('boost moves faster and never skips a cell', () => {
  const baseline = arena(); const boosted = arena();
  boosted.player.boostRequested = true;
  advance(baseline.game, .4); advance(boosted.game, .4);
  assert.ok(boosted.player.head.x > baseline.player.head.x);
  const blocked = arena(); blocked.player.boostRequested = true;
  blocked.game.obstacles.push({ x: 16, y: 12, width: 1, height: 1, warning: 0 });
  advance(blocked.game, .4);
  assert.equal(blocked.player.alive, false);
});

test('beans compound by 10%, diamonds add five length and stars last eight seconds', () => {
  const { game, player } = arena();
  for (let i = 0; i < 2; i++) { game.spawnFood('bean', player.head); game.collect(player); }
  assert.equal(player.score, 210); assert.equal(player.targetLength, 12);
  game.spawnFood('diamond', player.head); game.collect(player);
  assert.equal(player.targetLength, 17); assert.equal(player.itemCount, 1);
  game.spawnFood('star', player.head); game.collect(player);
  assert.equal(player.invincible, 8); assert.equal(player.targetLength, 19);
});

test('respawn preserves score, resets length and provides a safe protected lane', () => {
  const { game, player } = arena();
  player.score = 5000; game.kill(player, null, 'wall');
  advance(game, 3.01);
  assert.ok(player.alive); assert.equal(player.score, 5000); assert.equal(player.length, 8); assert.ok(player.shield > 1.9);
  assert.ok(player.body.every(p => game.inBounds(p) && !game.obstacleAt(p)));
});

test('pause freezes timer, snake movement and invincibility and clears boost', () => {
  const { game, player } = arena();
  player.invincible = 5; player.boostRequested = true; game.togglePause();
  const time = game.timeLeft, head = { ...player.head };
  advance(game, 2);
  assert.equal(game.timeLeft, time); assert.deepEqual(player.head, head); assert.equal(player.invincible, 5); assert.equal(player.boostRequested, false);
});

test('team allies pass through each other and respawn after five seconds', () => {
  const { game, player, enemy } = arena('team');
  enemy.team = player.team; enemy.spawn({ x: 13, y: 10 }, 0, 8, 0);
  game.moveSnakes([player]); assert.ok(player.alive);
  game.kill(player, null, 'mine'); assert.equal(player.respawnIn, 5);
});

test('45s team match decides by living total length and stops at zero', () => {
  const { game, player, enemy } = arena('team');
  assert.equal(game.timeLeft, 45); assert.deepEqual(game.teamLengths(), [10, 10]);
  enemy.body.pop(); game.timeLeft = .02;
  advance(game, .1);
  assert.equal(game.state, 'finished'); assert.equal(game.timeLeft, 0); assert.equal(game.result.winner, 0);
  assert.deepEqual(game.result.teamLengths, [player.length, enemy.length]);
});

test('fixed slices make movement independent of requestAnimationFrame cadence', () => {
  const a = arena(); const b = arena();
  for (let i = 0; i < 60; i++) a.game.update(1 / 60);
  for (let i = 0; i < 30; i++) b.game.update(1 / 30);
  assert.deepEqual(a.player.body, b.player.body);
  assert.ok(Math.abs(a.game.timeLeft - b.game.timeLeft) < 1e-9);
});

test('AI and generators survive full matches without invalid cells or non-finite scores', () => {
  for (const mode of ['team', 'classic']) {
    const game = new Game({ mode, random: seeded(123) }); game.start();
    game.player.isPlayer = false;
    let steps = 0;
    while (game.state === 'playing' && steps++ < 22000) {
      game.update(1 / 60);
      for (const snake of game.snakes) {
        assert.ok(Number.isFinite(snake.score));
        if (snake.alive) { assert.ok(snake.length >= 1); assert.ok(snake.body.every(p => game.inBounds(p))); }
      }
    }
    assert.equal(game.state, 'finished');
    assert.ok(game.snakes.reduce((sum, s) => sum + s.foodCount, 0) > 20, 'AI should seek food');
  }
});
