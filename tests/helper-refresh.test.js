const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { fixturePath, helperScript, parseProtocolJson, runHelper } = require('./test-utils');

function refreshArgs(extra = []) {
  return [
    '-Operation', 'refresh',
    '-BcContainersFixturePath', fixturePath('helper', 'bc-mixed.json'),
    '-DockerInspectFixturePath', fixturePath('helper', 'docker-inspect-mixed.json'),
    '-DockerStatsFixturePath', fixturePath('helper', 'docker-stats-mixed.json'),
    ...extra
  ];
}

test('refresh returns JSON contract for an empty BC container list', () => {
  const result = runHelper([
    '-Operation', 'refresh',
    '-BcContainersFixturePath', fixturePath('helper', 'bc-empty.json')
  ]);
  const payload = parseProtocolJson(result);

  assert.equal(payload.ok, true);
  assert.doesNotThrow(() => new Date(payload.refreshedAt).toISOString());
  assert.deepEqual(payload.summary, {
    total: 0,
    running: 0,
    cpuPercent: 0,
    memoryBytes: 0
  });
  assert.deepEqual(payload.containers, []);
  assert.equal(payload.error, null);
});

test('refresh preserves exact BCContainerHelper names and excludes Docker-only containers', () => {
  const payload = parseProtocolJson(runHelper(refreshArgs()));

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.containers.map((container) => container.name), [
    '234-rules-within-rules',
    'BC.Dev_26-A',
    'BC Name.With Spaces-01'
  ]);
  assert.equal(payload.containers.some((container) => container.name === 'docker-only'), false);
});

test('running BC containers receive Docker stats and stopped containers do not get fake usage', () => {
  const payload = parseProtocolJson(runHelper(refreshArgs()));
  const byName = Object.fromEntries(payload.containers.map((container) => [container.name, container]));

  assert.equal(byName['234-rules-within-rules'].state, 'running');
  assert.equal(byName['234-rules-within-rules'].health, 'healthy');
  assert.equal(byName['234-rules-within-rules'].cpuPercent, 9.8);
  assert.equal(byName['234-rules-within-rules'].memoryBytes, 3125800960);
  assert.equal(byName['234-rules-within-rules'].image, 'bctest:snapshot');

  assert.equal(byName['BC.Dev_26-A'].state, 'exited');
  assert.equal(byName['BC.Dev_26-A'].health, 'exited');
  assert.equal(byName['BC.Dev_26-A'].cpuPercent, null);
  assert.equal(byName['BC.Dev_26-A'].memoryBytes, null);

  assert.equal(byName['BC Name.With Spaces-01'].health, 'running');
});

test('summary aggregates only running BC container CPU and memory values', () => {
  const payload = parseProtocolJson(runHelper(refreshArgs()));

  assert.equal(payload.summary.total, 3);
  assert.equal(payload.summary.running, 2);
  assert.equal(payload.summary.cpuPercent, 18.4);
  assert.equal(payload.summary.memoryBytes, 3662671872);
});

test('BCContainerHelper failure keeps the refresh protocol JSON shape', () => {
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'refresh',
    '-FailureFixturePath', fixturePath('helper', 'bc-failure.json')
  ]));

  assert.equal(payload.ok, false);
  assert.deepEqual(Object.keys(payload), ['ok', 'refreshedAt', 'summary', 'containers', 'error']);
  assert.equal(payload.error.operation, 'Get-BcContainers');
  assert.equal(payload.error.exitCode, 127);
  assert.match(payload.error.stderr, /Get-BcContainers/);
});

test('Docker failure returns exact failing operation without falling back to Docker identity', () => {
  const payload = parseProtocolJson(runHelper(refreshArgs([
    '-FailureFixturePath', fixturePath('helper', 'docker-failure.json')
  ])));

  assert.equal(payload.ok, false);
  assert.equal(payload.error.operation, 'docker inspect');
  assert.equal(payload.error.exitCode, 1);
  assert.match(payload.error.stderr, /Docker Desktop is not running/);
  assert.deepEqual(payload.containers, []);
});

test('helper source keeps Docker behind BC identity and out of lifecycle control', () => {
  const source = fs.readFileSync(helperScript, 'utf8');

  assert.doesNotMatch(source, /docker\s+(start|stop|restart|rm|remove)\b/i);
  assert.match(source, /Import-Module -Name 'BcContainerHelper' -ErrorAction Stop \*>\s*\$null/);
  assert.match(source, /Get-BcContainers/);
  assert.match(source, /Invoke-DockerInspect -Names \$Names/);
});
