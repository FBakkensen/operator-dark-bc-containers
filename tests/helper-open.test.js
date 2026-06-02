const assert = require('node:assert/strict');
const test = require('node:test');
const { fixturePath, parseProtocolJson, runHelper } = require('./test-utils');

test('open launches the web client URL and reports structured success', () => {
  // Fixture short-circuits the real Start-Process so the suite never spawns a browser.
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'open',
    '-Url', 'http://233-configuration-attribute-copilot/bc',
    '-ActionResultFixturePath', fixturePath('helper', 'action-success.json')
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.action, 'open');
  assert.equal(payload.command, 'Start-Process http://233-configuration-attribute-copilot/bc');
  assert.deepEqual(payload.arguments, ['http://233-configuration-attribute-copilot/bc']);
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.error, null);
});

test('open without a URL is rejected before any launch', () => {
  const payload = parseProtocolJson(runHelper(['-Operation', 'open']));

  assert.equal(payload.ok, false);
  assert.equal(payload.action, 'open');
  assert.equal(payload.command, null);
  assert.deepEqual(payload.arguments, []);
  assert.equal(payload.error.operation, 'ValidateUrl');
  assert.match(payload.stderr, /URL is required/);
});

test('open refuses non-http(s) URLs so the helper cannot launch arbitrary targets', () => {
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'open',
    '-Url', 'file:///C:/windows/system32/calc.exe'
  ]));

  assert.equal(payload.ok, false);
  assert.equal(payload.error.operation, 'ValidateUrl');
  assert.match(payload.stderr, /non-http/);
});

test('open surfaces launch failure with exact command and stderr', () => {
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'open',
    '-Url', 'http://bc/bc',
    '-ActionResultFixturePath', fixturePath('helper', 'action-failure.json')
  ]));

  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'Start-Process http://bc/bc');
  assert.equal(payload.exitCode, 1);
  assert.equal(payload.error.operation, 'open');
});
