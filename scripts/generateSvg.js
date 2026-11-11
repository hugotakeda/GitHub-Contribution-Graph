// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { createSnakeAnimation } = require('./snake');

// ── Config ────────────────────────────────────────────────────────────────────
const USERNAME = process.env.GITHUB_USERNAME || process.argv[2];
const TOKEN    = process.env.GH_TOKEN        || process.argv[3];
const TIMEZONE = process.env.TIMEZONE        || 'UTC';

// ── Energy State ──────────────────────────────────────────────────────────────
const STATES = {
  none:       { label: 'No commits',         color: '#161b22', glow: 'none' },
  madrugada:  { label: 'Late Night',   color: '#6e40c9', glow: '#6e40c9' }, // 00-05
  manha:      { label: 'Morning',   color: '#f2cc60', glow: '#f2cc60' }, // 06-11
  tarde:      { label: 'Afternoon', color: '#ff7b72', glow: '#ff7b72' }, // 12-17
  noite:      { label: 'Evening',    color: '#3fb950', glow: '#3fb950' }, // 18-23
};

function getEnergyState(hour) {
  if (hour >= 0  && hour <  6)  return 'madrugada';
  if (hour >= 6  && hour < 12)  return 'manha';
  if (hour >= 12 && hour < 18)  return 'tarde';
  return 'noite';
}

function getOpacity(count) {
  if (count === 0) return 1;
  if (count <= 2)  return 0.45;
  if (count <= 5)  return 0.70;
  if (count <= 9)  return 0.88;
  return 1;
}

// ── Fetch GitHub commits ───────────────────────────────────────────────────────
// Only exclude this repository's known generated commits. Human commits made
// through GitHub's web UI, including web-flow commits, must remain visible.
function isGeneratedCommit(repoName, commit, username) {
  const expectedRepo = `${username}/GitHub-Contribution-Graph`.toLowerCase();
  const oldRepo = `${username}/Energy-Rhythm-Contribution-Graph`.toLowerCase();
  return [expectedRepo, oldRepo].includes(repoName.toLowerCase())
    && commit.messageHeadline === 'chore: update energy rhythm graph [skip ci]'
    && commit.committer?.user?.login === 'github-actions[bot]';
}

async function fetchCommits(username, token, now = new Date(), fetchImpl = fetch) {
  // Include the entire first local day, even when its UTC date differs.
  const since = new Date(now.getTime() - 366 * 86400000).toISOString();
  async function query(document, variables) {
    const res = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: document, variables }),
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    const { data, errors } = await res.json();
    if (errors) throw new Error('GraphQL errors: ' + errors.map(e => e.message).join(', '));
    return data;
  }

  const reposQuery = `
    query($username: String!, $after: String) {
      user(login: $username) {
        id
        repositories(first: 100, after: $after, isFork: false,
          ownerAffiliations: [OWNER, COLLABORATOR], orderBy: {field: NAME, direction: ASC}) {
          pageInfo { hasNextPage endCursor }
          nodes { nameWithOwner defaultBranchRef { target { oid } } }
        }
      }
    }`;
  const historyQuery = `
    query($owner: String!, $name: String!, $head: String!, $author: ID!,
          $since: GitTimestamp!, $after: String) {
      repository(owner: $owner, name: $name) {
        object(expression: $head) {
          ... on Commit {
            history(since: $since, first: 100, after: $after, author: {id: $author}) {
              pageInfo { hasNextPage endCursor }
              nodes {
                oid authoredDate messageHeadline
                author { user { login } }
                committer { user { login } }
              }
            }
          }
        }
      }
    }`;
  const repos = [];
  let after = null;
  let author;
  do {
    const { user } = await query(reposQuery, { username, after });
    if (!user) throw new Error(`GitHub user not found: ${username}`);
    author = user.id;
    repos.push(...user.repositories.nodes);
    const page = user.repositories.pageInfo;
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);

  const commits = new Map();
  for (const repo of repos) {
    const head = repo.defaultBranchRef?.target?.oid;
    if (!head) continue;
    const [owner, name] = repo.nameWithOwner.split('/');
    after = null;
    do {
      const data = await query(historyQuery, { owner, name, head, author, since, after });
      const history = data.repository?.object?.history;
      if (!history) throw new Error(`Commit history unavailable: ${repo.nameWithOwner}`);
      for (const node of history.nodes) {
        if (node.author?.user?.login?.toLowerCase() === username.toLowerCase()
            && !isGeneratedCommit(repo.nameWithOwner, node, username)) {
          commits.set(node.oid, node.authoredDate);
        }
      }
      after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
    } while (after);
  }
  return [...commits.values()];
}

// ── Build daily energy map ─────────────────────────────────────────────────────
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', timeZone: timezone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

function buildDayMap(commitDates, now = new Date(), timezone = TIMEZONE) {
  const map = new Map();
  const today = new Date(localParts(now, timezone).date + 'T00:00:00Z');
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().split('T')[0];
    map.set(key, { date: key, total: 0, details: { madrugada: 0, manha: 0, tarde: 0, noite: 0 } });
  }

  for (const iso of commitDates) {
    const { date: key, hour } = localParts(new Date(iso), timezone);
    const state = getEnergyState(hour);
    if (map.has(key)) {
      map.get(key).total++;
      map.get(key).details[state]++;
    }
  }

  const days = Array.from(map.values());
  for (const day of days) {
    if (day.total === 0) {
      day.state = 'none';
    } else {
      day.state = Object.entries(day.details).reduce((a, b) => b[1] > a[1] ? b : a)[0];
    }
  }

  return days;
}

// ── SVG dimensions ─────────────────────────────────────────────────────────────
// Precision Alignment: Targeting 775px total width (Stats 467px + Tech 300px + Gap 8px).
const CELL     = 11;   
const GAP      = 2;
const STEP     = CELL + GAP;
const TOP_PAD  = 18;   
const COLS     = 53;
const ROWS     = 7;

const SIDE_PAD = 27;   // exact margins to hit 775px
const DAY_PAD  = 32;   // space for weekday labels
const BOT_PAD  = 35;   // compact legend

const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Build SVG ──────────────────────────────────────────────────────────────────
function buildSvg(days, options = {}) {
  const firstDate   = new Date(days[0].date);
  const firstDow    = firstDate.getUTCDay();
  const paddedDays  = [...Array(firstDow).fill(null), ...days];

  const weeks = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    weeks.push(paddedDays.slice(i, i + 7));
  }

  const graphWidth = weeks.length * STEP;
  const LEFT_PAD   = SIDE_PAD + DAY_PAD;
  const WIDTH      = graphWidth + LEFT_PAD + SIDE_PAD;  // aligns to exactly 775px
  const HEIGHT     = TOP_PAD + ROWS * STEP + BOT_PAD + 28;

  const food = [];
  weeks.forEach((week, x) => week.forEach((day, y) => {
    if (day && day.total > 0) food.push({ x, y, color: STATES[day.state].color });
  }));
  const snake = options.animate === false ? { foodAnimation: () => '', overlay: '' }
    : createSnakeAnimation({
      cols: weeks.length, rows: ROWS, food,
      seed: options.seed || days.map(day => `${day.date}:${day.total}:${day.state}`).join('|'),
      left: LEFT_PAD, top: TOP_PAD, step: STEP, cell: CELL,
      statusY: HEIGHT - 9, width: WIDTH,
    });

  // – weekday labels –
  const dayLabels_svg = WEEKDAYS.map((day, di) => {
    const y = TOP_PAD + di * STEP + 9;
    return `<text x="${SIDE_PAD}" y="${y}" fill="#555e6b" font-size="9" font-family="monospace">${day}</text>`;
  }).join('\n  ');

  // – month labels –
  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstReal = week.find(Boolean);
    if (!firstReal) return;
    const m = new Date(firstReal.date).getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      monthLabels.push({ x: LEFT_PAD + wi * STEP, label: MONTHS[m] });
    }
  });

  // – cells –
  const cells = [];
  const animDefs = [];

  weeks.forEach((week, wi) => {
    week.forEach((day, di) => {
      if (!day) return;
      const x       = LEFT_PAD + wi * STEP;
      const y       = TOP_PAD + di * STEP;
      const state   = day.state;
      const cfg     = STATES[state];
      const op      = getOpacity(day.total);
      const hasGlow = day.total > 5 && state !== 'none';
      const filterId = `glow-${wi}-${di}`;

      if (hasGlow) {
        animDefs.push(`
  <filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="2" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`);
      }

      const fillColor  = cfg.color;
      const filterAttr = hasGlow ? ` filter="url(#${filterId})"` : '';
      const stateLabel = STATES[state].label.replace(/[^\w\s]/g, '').trim();
      const tooltip    = `${day.date} — ${day.total} commit${day.total !== 1 ? 's' : ''} | ${stateLabel}`;

      cells.push(`
    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${STATES.none.color}"/>
    <g class="contribution-food" opacity="1">
      ${day.total > 0 ? snake.foodAnimation(wi + ',' + di) : ''}
    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2"
          fill="${fillColor}" fill-opacity="${op}"${filterAttr}>
      <title>${tooltip}</title>
    </rect></g>`);
    });
  });

  // – legend –
  const legendItems = [
    { state: 'madrugada', label: 'Late Night',   hours: '00h – 05h' },
    { state: 'manha',     label: 'Morning',   hours: '06h – 11h' },
    { state: 'tarde',     label: 'Afternoon', hours: '12h – 17h' },
    { state: 'noite',     label: 'Evening',    hours: '18h – 23h' },
  ];

  const legendY          = TOP_PAD + ROWS * STEP + 12;
  const itemWidth        = 135; // tighter for 775px
  const totalLegendWidth = legendItems.length * itemWidth;
  const legendStartX     = Math.floor((WIDTH - totalLegendWidth) / 2);

  const legendItems_svg = legendItems.map((item, i) => {
    const lx = legendStartX + i * itemWidth;
    return `
    <rect x="${lx}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${STATES[item.state].color}"/>
    <text x="${lx + CELL + 6}" y="${legendY + 8}"  fill="#8b949e" font-size="9" font-family="monospace">${item.label}</text>
    <text x="${lx + CELL + 6}" y="${legendY + 18}" fill="#555e6b" font-size=\"7\"  font-family=\"monospace\">${item.hours}</text>`;
  }).join('');

  const pulseAnim = `
  <style>
    @keyframes pulse { 0%,100%{opacity:.85} 50%{opacity:1} }
    .glow-cell { animation: pulse 2.5s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .snake-layer { display: none; }
      .contribution-food { opacity: 1 !important; }
    }
  </style>`;

  return `<svg xmlns="http://www.w3.org/2000/svg"
     width="${WIDTH}" height="${HEIGHT}"
     viewBox="0 0 ${WIDTH} ${HEIGHT}"
     role="img"
     aria-label="Energy Rhythm Contribution Graph for ${USERNAME}">
  <desc>Commits by time of day. A simulated snake eats active squares of every color, grows, and can clear the board or collide with its body. Rounds repeat; routes change when contribution data changes. Reduced motion shows the static calendar.</desc>
  <defs>
    ${animDefs.join('')}
  </defs>
  ${pulseAnim}

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" rx=\"8\" fill=\"#0d1117\"/>

  <!-- Weekday Labels -->
  ${dayLabels_svg}

  <!-- Month labels -->
  ${monthLabels.map(m => `<text x="${m.x}" y="14" fill="#8b949e" font-size="10" font-family="monospace">${m.label}</text>`).join('\n  ')}

  <!-- Cells -->
  ${cells.join('')}

  <!-- Precomputed snake rounds; no JavaScript runs in the image. -->
  ${snake.overlay}

  <!-- Legend -->
  ${legendItems_svg}
</svg>`;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  if (!USERNAME) throw new Error('GITHUB_USERNAME is not set.');
  if (!TOKEN) throw new Error('GH_TOKEN is not set. Check the GRAPH_TOKEN secret.');
  console.log(`Fetching commits for @${USERNAME}...`);
  const commitDates = await fetchCommits(USERNAME, TOKEN);
  console.log(`  → ${commitDates.length} commits found`);

  const days = buildDayMap(commitDates);
  const svg  = buildSvg(days);

  const outDir = path.resolve(__dirname, '..', 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'energy-rhythm.svg');
  fs.writeFileSync(outPath, svg, 'utf8');
  console.log(`  → SVG written to ${outPath}`);
}

module.exports = { STATES, getEnergyState, isGeneratedCommit, fetchCommits, buildDayMap, buildSvg };
if (require.main === module) {
  main().catch(err => { console.error(err); process.exitCode = 1; });
}
