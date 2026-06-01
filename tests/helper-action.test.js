const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { fixturePath, helperScript, parseProtocolJson, runHelper } = require('./test-utils');

const actionMap = {
  start: 'Start-BcContainer',
  stop: 'Stop-BcContainer',
  restart: 'Restart-BcContainer',
  remove: 'Remove-BcContainer'
};

for (const [action, command] of Object.entries(actionMap)) {
  test(`${action} maps to ${command} with structured success output`, () => {
    const payload = parseProtocolJson(runHelper([
      '-Operation', 'action',
      '-Action', action,
      '-ContainerName', 'BC.Dev_26-A',
      '-ActionResultFixturePath', fixturePath('helper', 'action-success.json')
    ]));

    assert.equal(payload.ok, true);
    assert.equal(payload.action, action);
    assert.equal(payload.container, 'BC.Dev_26-A');
    assert.equal(payload.command, `${command} BC.Dev_26-A`);
    assert.deepEqual(payload.arguments, ['BC.Dev_26-A']);
    assert.doesNotThrow(() => new Date(payload.startedAt).toISOString());
    assert.doesNotThrow(() => new Date(payload.finishedAt).toISOString());
    assert.equal(payload.exitCode, 0);
    assert.equal(payload.stdout, 'action completed');
    assert.equal(payload.stderr, '');
  });
}

test('unknown lifecycle actions are rejected before shell execution', () => {
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'action',
    '-Action', 'pause',
    '-ContainerName', 'BC.Dev_26-A',
    '-ActionResultFixturePath', fixturePath('helper', 'action-success.json')
  ]));

  assert.equal(payload.ok, false);
  assert.equal(payload.command, null);
  assert.deepEqual(payload.arguments, []);
  assert.equal(payload.error.operation, 'ValidateAction');
  assert.match(payload.stderr, /Unsupported lifecycle action: pause/);
});

test('action failure includes exact command, exit code, stdout, and stderr', () => {
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'action',
    '-Action', 'stop',
    '-ContainerName', 'missing-container',
    '-ActionResultFixturePath', fixturePath('helper', 'action-failure.json')
  ]));

  assert.equal(payload.ok, false);
  assert.equal(payload.action, 'stop');
  assert.equal(payload.command, 'Stop-BcContainer missing-container');
  assert.equal(payload.exitCode, 1);
  assert.equal(payload.stdout, '');
  assert.match(payload.stderr, /container not found/);
  assert.equal(payload.error.operation, 'Stop-BcContainer');
});

test('action source treats BCContainerHelper information output as structured stdout, not failure stderr', () => {
  const source = fs.readFileSync(helperScript, 'utf8');

  assert.match(source, /\$Item -is \[System\.Management\.Automation\.ErrorRecord\]/);
  assert.doesNotMatch(source, /InformationRecord/);
  assert.doesNotMatch(source, /WarningRecord/);
});

test('container names are represented as one helper argument, including shell-looking text', () => {
  const trickyName = 'BC Name; Remove-Item C:\\temp\\not-real';
  const payload = parseProtocolJson(runHelper([
    '-Operation', 'action',
    '-Action', 'restart',
    '-ContainerName', trickyName,
    '-ActionResultFixturePath', fixturePath('helper', 'action-success.json')
  ]));

  assert.equal(payload.command, `Restart-BcContainer ${trickyName}`);
  assert.deepEqual(payload.arguments, [trickyName]);
});

test('action implementation uses BCContainerHelper commands, not Docker lifecycle commands or expression evaluation', () => {
  const source = fs.readFileSync(helperScript, 'utf8');

  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /docker\s+(start|stop|restart|rm|remove)\b/i);
  assert.match(source, /start = 'Start-BcContainer'/);
  assert.match(source, /stop = 'Stop-BcContainer'/);
  assert.match(source, /restart = 'Restart-BcContainer'/);
  assert.match(source, /remove = 'Remove-BcContainer'/);
  assert.match(source, /& \$CommandName \$ContainerName \*>&1/);
});
