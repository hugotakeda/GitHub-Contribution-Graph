'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATES, getEnergyState, isGeneratedCommit, fetchCommits, buildDayMap, buildSvg } = require('../scripts/generateSvg');

test('time bands and plain English legend', () => {
  assert.deepEqual([0,5,6,11,12,17,18,23].map(getEnergyState),
    ['madrugada','madrugada','manha','manha','tarde','tarde','noite','noite']);
  assert.deepEqual(Object.values(STATES).slice(1).map(s => s.label),
    ['Late Night','Morning','Afternoon','Evening']);
});

test('only the known graph automation is filtered', () => {
  const commit = { messageHeadline: 'chore: update energy rhythm graph [skip ci]',
    committer: { user: { login: 'github-actions[bot]' } } };
  assert.equal(isGeneratedCommit('hugotakeda/GitHub-Contribution-Graph', commit, 'hugotakeda'), true);
  assert.equal(isGeneratedCommit('hugotakeda/Energy-Rhythm-Contribution-Graph', commit, 'hugotakeda'), true);
  assert.equal(isGeneratedCommit('hugotakeda/my-app', commit, 'hugotakeda'), false);
  assert.equal(isGeneratedCommit('hugotakeda/GitHub-Contribution-Graph',
    { ...commit, messageHeadline: 'Fix graph renderer' }, 'hugotakeda'), false);
  assert.equal(isGeneratedCommit('hugotakeda/GitHub-Contribution-Graph',
    { ...commit, committer: { user: { login: 'web-flow' } } }, 'hugotakeda'), false);
});

test('local day boundaries include local today and midnight is Late Night', () => {
  const now = new Date('2026-11-11T01:00:00Z'); // Still November 10 in Sao Paulo
  const dates = ['2026-11-10T03:00:00Z', '2026-11-11T00:30:00Z', '2026-11-09T14:00:00Z'];
  const days = buildDayMap(dates, now, 'America/Sao_Paulo');
  assert.equal(days.length, 365);
  const today = days.at(-1);
  assert.equal(today.date, '2026-11-10');
  assert.equal(today.details.madrugada, 1);
  assert.equal(today.details.noite, 1);
  assert.equal(days.at(-2).details.manha, 1);
  assert.equal(buildDayMap(['2026-11-11T00:00:00Z'], new Date('2026-11-11T12:00:00Z'), 'UTC').at(-1).state, 'madrugada');
  const svg = buildSvg(days);
  for (const label of ['Late Night','Morning','Afternoon','Evening']) assert.ok(svg.includes(label));
  for (const label of ['Shadow Mode','Logic Prime','Peak Velocity','Flow State']) assert.ok(!svg.includes(label));
});

test('repository and history pagination preserve real commits beyond automation and deduplicate OIDs', async () => {
  const page = (hasNextPage = false, endCursor = null) => ({ hasNextPage, endCursor });
  const human = (oid, date) => ({ oid, authoredDate: date, messageHeadline: 'Feature',
    author: { user: { login: 'HugoTakeda' } }, committer: { user: { login: 'web-flow' } } });
  const bot = { ...human('bot', '2026-11-10T03:00:00Z'),
    messageHeadline: 'chore: update energy rhythm graph [skip ci]',
    committer: { user: { login: 'github-actions[bot]' } } };
  const repo = (name) => ({ nameWithOwner: 'hugotakeda/' + name, defaultBranchRef: { target: { oid: 'head-' + name } } });
  const seen = [];
  const mockFetch = async (_url, options) => {
    const { query, variables: v } = JSON.parse(options.body);
    seen.push(v);
    let data;
    if (query.includes('user(login:')) {
      data = { user: { id: 'user-id', repositories: v.after
        ? { nodes: [repo('my-app'), { nameWithOwner: 'hugotakeda/empty', defaultBranchRef: null }], pageInfo: page() }
        : { nodes: [repo('GitHub-Contribution-Graph')], pageInfo: page(true, 'repos-next') } } };
    } else {
      assert.equal(v.author, 'user-id');
      let nodes, pageInfo;
      if (v.name === 'GitHub-Contribution-Graph' && !v.after) {
        nodes = [bot]; pageInfo = page(true, 'history-next');
      } else if (v.name === 'GitHub-Contribution-Graph') {
        nodes = [human('real-1', '2026-11-01T10:00:00Z')]; pageInfo = page();
      } else {
        nodes = [human('real-1', '2026-11-01T10:00:00Z'), human('real-2', '2026-11-02T12:00:00Z')]; pageInfo = page();
      }
      data = { repository: { object: { history: { nodes, pageInfo } } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  const dates = await fetchCommits('hugotakeda', 'test-token', new Date('2026-11-11T12:00:00Z'), mockFetch);
  assert.deepEqual(dates, ['2026-11-01T10:00:00Z', '2026-11-02T12:00:00Z']);
  assert.equal(seen.length, 5);
  assert.ok(seen.some(v => v.after === 'history-next'));
  assert.ok(seen.some(v => v.after === 'repos-next'));
});

test('API failures fail the build instead of publishing a partial graph', async () => {
  await assert.rejects(fetchCommits('hugotakeda', 'test', new Date(),
    async () => ({ ok: true, json: async () => ({ errors: [{ message: 'rate limited' }] }) })), /rate limited/);
});
