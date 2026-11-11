'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { key, adjacent, random, makeRoute, simulateRound, createSnakeAnimation } = require('../scripts/snake');

test('randomized routes stay adjacent, in bounds and cover each cell exactly once', () => {
  for (const [cols, rows] of [[53, 7], [54, 7], [1, 7], [4, 4]]) {
    for (let seed = 0; seed < 10; seed++) {
      const route = makeRoute(cols, rows, random(seed));
      assert.equal(route.length, cols * rows);
      assert.equal(new Set(route.map(key)).size, route.length);
      route.forEach((p, i) => {
        assert.ok(p.x >= 0 && p.x < cols && p.y >= 0 && p.y < rows);
        if (i) assert.ok(adjacent(route[i - 1], p));
      });
    }
  }
});

const food = Array.from({ length: 36 }, (_, i) => ({
  x: i % 6, y: Math.floor(i / 6), color: ['purple', 'gold', 'orange', 'green'][i % 4],
}));

test('safe routes eat all colors, grow and win only after every square is consumed', () => {
  const round = simulateRound({ cols: 6, rows: 6, food, rng: random('win'), risk: 0 });
  assert.equal(round.outcome, 'won');
  assert.equal(round.frames.at(-1).eaten, food.length);
  assert.equal(round.frames.at(-1).body.length, food.length);
  assert.equal(new Set(round.frames.map(f => f.consumed).filter(Boolean)).size, food.length);
  for (const [i, frame] of round.frames.entries()) {
    assert.equal(new Set(frame.body.map(key)).size, frame.body.length);
    if (i) assert.ok(adjacent(round.frames[i - 1].head, frame.head));
  }
});

test('a loss is a real adjacent collision with occupied non-vacating body', () => {
  const round = simulateRound({ cols: 6, rows: 6, food, rng: random('loss'), risk: 1 });
  assert.equal(round.outcome, 'lost');
  const last = round.frames.at(-1), previous = round.frames.at(-2);
  assert.ok(adjacent(last.head, previous.head));
  assert.ok(previous.body.slice(2, -1).some(p => key(p) === key(last.head)));
  assert.equal(last.eaten, previous.eaten);
  assert.ok(last.eaten < food.length);
});

test('same data seed is reproducible, different seeds vary routes and ignore food color', () => {
  const play = (seed, items = food) => simulateRound({ cols: 6, rows: 6, food: items, rng: random(seed), risk: 0 });
  assert.deepEqual(play('same'), play('same'));
  assert.notDeepEqual(play('a').frames.map(f => f.head), play('b').frames.map(f => f.head));
  assert.deepEqual(play('a').frames.map(f => f.head),
    play('a', food.map(p => ({ ...p, color: 'red' }))).frames.map(f => f.head));
});

test('empty board stays static; one square can win without a fake self-collision', () => {
  const options = { cols: 6, rows: 6, food: [], seed: 'empty', left: 0, top: 0, step: 13,
    cell: 11, statusY: 120, width: 80 };
  assert.equal(createSnakeAnimation(options).overlay, '');
  const round = simulateRound({ ...options, food: [food[0]], rng: random('one'), risk: 1 });
  assert.equal(round.outcome, 'won');
  assert.equal(round.frames.at(-1).eaten, 1);
});

test('SVG uses synchronized looping declarative animation without embedded scripts', () => {
  const animation = createSnakeAnimation({ cols: 6, rows: 6, food, seed: 'loop', left: 0,
    top: 0, step: 13, cell: 11, statusY: 120, width: 80 });
  const svg = animation.overlay + animation.foodAnimation(key(food[0]));
  assert.ok(!svg.includes('<script'));
  assert.ok(svg.includes('repeatCount="indefinite"'));
  assert.equal(new Set([...svg.matchAll(/dur="([^"]+)"/g)].map(m => m[1])).size, 1);
  for (const match of svg.matchAll(/values="([^"]+)" keyTimes="([^"]+)"/g)) {
    const times = match[2].split(';').map(Number);
    assert.equal(times.length, match[1].split(';').length);
    assert.equal(times[0], 0);
    assert.equal(times.at(-1), 1);
    times.slice(1).forEach((time, i) => assert.ok(time > times[i]));
  }
});
