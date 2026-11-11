'use strict';

const key = point => point.x + ',' + point.y;
const STEP_SECONDS = 0.25;
const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function random(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Randomized backbite moves preserve a continuous, non-self-intersecting path
// covering the board. Color is never used in route planning.
function makeRoute(cols, rows, rng) {
  let route = [];
  for (let x = 0; x < cols; x++) {
    for (let j = 0; j < rows; j++) route.push({ x, y: x % 2 ? rows - 1 - j : j });
  }
  for (let i = 0; i < cols * rows * 12; i++) {
    if (rng() < 0.5) route.reverse();
    const start = route[0];
    const candidates = [];
    for (let j = 2; j < route.length; j++) if (adjacent(start, route[j])) candidates.push(j);
    if (!candidates.length) continue;
    const cut = candidates[Math.floor(rng() * candidates.length)];
    route = route.slice(0, cut).reverse().concat(route.slice(cut));
  }
  return route;
}

function simulateRound({ cols, rows, food, rng, risk = 0.012 }) {
  let route = makeRoute(cols, rows, rng);
  const foodKeys = new Set(food.map(key));
  // Prefer an empty spawn so every eaten square adds one visible body segment.
  for (let attempt = 0; foodKeys.has(key(route[0])) && food.length < cols * rows && attempt < 32; attempt++) {
    if (!foodKeys.has(key(route.at(-1)))) { route.reverse(); break; }
    route = makeRoute(cols, rows, rng);
  }
  const remaining = new Map(food.map(item => [key(item), item]));
  const frames = [];
  let body = [];
  let capacity = 1;
  const colors = ['#e6edf3'];
  let eaten = 0;
  let color = '#e6edf3';
  for (const point of route) {
    if (body.length > 3 && remaining.size && rng() < risk) {
      // A random wrong turn can hit occupied body. Never mistake a vacating
      // tail or the neck (an immediate reverse) for a legal self-collision.
      const choices = body.slice(2, -1).filter(part => adjacent(body[0], part));
      if (choices.length) {
        const hit = choices[Math.floor(rng() * choices.length)];
        frames.push({ head: hit, body: [...body], eaten, consumed: null,
          status: 'lost', color: '#ff7b72', colors: [...colors] });
        return { frames, outcome: 'lost', total: food.length };
      }
    }
    const meal = remaining.get(key(point));
    if (meal) {
      remaining.delete(key(point));
      // On a completely full board the spawn square itself becomes the head.
      // Every subsequent meal adds exactly one segment; empty moves add none.
      if (body.length) {
        capacity++;
        colors.push(meal.color);
      } else {
        colors[0] = meal.color;
      }
      eaten++;
      color = meal.color;
    }
    body.unshift(point);
    if (body.length > capacity) body.pop();
    const status = remaining.size ? 'running' : 'won';
    frames.push({ head: point, body: [...body], eaten, consumed: meal ? key(point) : null,
      status, color: status === 'won' ? '#3fb950' : color, colors: [...colors] });
    if (status === 'won') return { frames, outcome: 'won', total: food.length };
  }
  throw new Error('Route ended before all food was visited');
}

function animate(attribute, events, duration, transform = false) {
  const clean = [];
  for (const [time, value] of events) {
    if (clean.length && clean.at(-1)[0] === time) clean[clean.length - 1] = [time, value];
    else if (!clean.length || clean.at(-1)[1] !== value) clean.push([time, value]);
  }
  if (clean.length < 2) return '';
  if (clean.at(-1)[0] < duration) clean.push([duration, clean.at(-1)[1]]);
  const times = clean.map(([time]) => (time / duration).toFixed(6)).join(';');
  const values = clean.map(([, value]) => value).join(';');
  const tag = transform ? 'animateTransform' : 'animate';
  return `<${tag} attributeName="${attribute}"${transform ? ' type="translate"' : ''} values="${values}" keyTimes="${times}" dur="${duration.toFixed(3)}s" calcMode="discrete" repeatCount="indefinite"/>`;
}

function createSnakeAnimation({ cols, rows, food, seed, left, top, step, cell, statusY, width, rounds = 3 }) {
  if (!food.length) return { foodAnimation: () => '', overlay: '', duration: 0, rounds: [] };
  const rng = random(seed);
  const simulations = Array.from({ length: rounds }, () =>
    simulateRound({ cols, rows, food, rng, risk: rng() < 0.45 ? 0 : 0.018 }));
  const foodEvents = new Map(food.map(point => [key(point), [[0, 1]]]));
  const bodyEvents = new Map();
  const bodyColorEvents = new Map();
  const position = [[0, '0 0']];
  const visibility = [[0, 0]];
  const headColor = [[0, '#e6edf3']];
  const messages = [];
  let time = 2;
  const tick = STEP_SECONDS;
  for (const [roundIndex, round] of simulations.entries()) {
    const start = time;
    const playing = [[0, 0], [start, 1]];
    visibility.push([start, 1]);
    let occupied = new Set();
    for (const frame of round.frames) {
      const next = new Set(frame.body.map(key));
      for (const id of new Set([...occupied, ...next])) {
        if (occupied.has(id) === next.has(id)) continue;
        if (!bodyEvents.has(id)) bodyEvents.set(id, [[0, 0]]);
        bodyEvents.get(id).push([time, next.has(id) ? 1 : 0]);
      }
      occupied = next;
      frame.body.forEach((part, index) => {
        const id = key(part);
        if (!bodyColorEvents.has(id)) bodyColorEvents.set(id, [[0, '#e6edf3']]);
        bodyColorEvents.get(id).push([time, frame.colors[index]]);
      });
      position.push([time, `${left + frame.head.x * step} ${top + frame.head.y * step}`]);
      headColor.push([time, frame.color]);
      if (frame.consumed) foodEvents.get(frame.consumed).push([time, 0]);
      time += tick;
    }
    const finish = time - tick;
    playing.push([finish, 0]);
    const result = [[0, 0], [finish, 1]];
    messages.push({ text: `Snake · Round ${roundIndex + 1} · ${food.length} squares`, events: playing, color: '#8b949e' });
    messages.push({
      text: round.outcome === 'won' ? `All ${food.length} squares eaten · You win!`
        : `Self collision · Game over · ${round.frames.at(-1).eaten}/${food.length} eaten`,
      events: result, color: round.outcome === 'won' ? '#3fb950' : '#ff7b72',
    });
    time += 2.5;
    result.push([time, 0]);
    visibility.push([time, 0]);
    for (const id of occupied) bodyEvents.get(id).push([time, 0]);
    for (const events of foodEvents.values()) events.push([time, 1]);
    time += 2;
  }
  const duration = time;
  const bodies = [...bodyEvents].map(([id, events]) => {
    const [x, y] = id.split(',').map(Number);
    return `<rect x="${left + x * step}" y="${top + y * step}" width="${cell}" height="${cell}" rx="2" fill="#e6edf3" opacity="0">${animate('opacity', events, duration)}${animate('fill', bodyColorEvents.get(id), duration)}</rect>`;
  }).join('');
  const labels = messages.map(message =>
    `<text x="${width / 2}" y="${statusY}" text-anchor="middle" font-family="monospace" font-size="10" fill="${message.color}" opacity="0">${message.text}${animate('opacity', message.events, duration)}</text>`).join('');
  const overlay = `
  <g class="snake-layer" aria-hidden="true">
    ${bodies}
    <g opacity="0">${animate('opacity', visibility, duration)}
      <g>${animate('transform', position, duration, true)}
        <rect width="${cell}" height="${cell}" rx="3" fill="#e6edf3" stroke="#0d1117" stroke-width=".7">
          ${animate('fill', headColor, duration)}
        </rect>
        <circle cx="3.5" cy="3.5" r="1" fill="#0d1117"/>
        <circle cx="7.5" cy="3.5" r="1" fill="#0d1117"/>
      </g>
    </g>
    ${labels}
  </g>`;
  return {
    foodAnimation: id => animate('opacity', foodEvents.get(id) || [[0, 1]], duration),
    overlay, duration, rounds: simulations,
  };
}

module.exports = { STEP_SECONDS, key, adjacent, random, makeRoute, simulateRound, createSnakeAnimation };
