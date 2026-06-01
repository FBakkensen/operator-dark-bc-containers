const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixturePath, helperCmd, helperScript, repoRoot, runHelperCmd, parseProtocolJson } = require('./test-utils');

test('package exposes a deterministic buildless test command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.js');
  assert.equal(packageJson.scripts.build, undefined);
  assert.equal(packageJson.dependencies, undefined);
  assert.deepEqual(Object.keys(packageJson.devDependencies ?? {}), ['jsdom']);
});

test('fixture layout exists for helper, widget, pack, and install contracts', () => {
  for (const folder of ['helper', 'widget', 'pack', 'install']) {
    assert.equal(fs.statSync(fixturePath(folder)).isDirectory(), true, `${folder} fixture folder is missing`);
  }
});

test('helper entrypoint paths are present and wrapper stays stdout quiet', () => {
  assert.equal(fs.existsSync(helperScript), true);
  assert.equal(fs.existsSync(helperCmd), true);

  const wrapper = fs.readFileSync(helperCmd, 'utf8');
  assert.match(wrapper, /^@echo off/m);
  assert.match(wrapper, /pwsh\.exe/i);
  assert.doesNotMatch(wrapper, /powershell\.exe/i);
  assert.match(wrapper, /bc-containers\.ps1/i);

  const result = runHelperCmd([
    '-Operation', 'refresh',
    '-BcContainersFixturePath', fixturePath('helper', 'bc-empty.json')
  ]);
  const payload = parseProtocolJson(result);

  assert.equal(payload.ok, true);
  assert.equal(payload.summary.total, 0);
});
