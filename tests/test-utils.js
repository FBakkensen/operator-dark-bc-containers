const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const helperScript = path.join(repoRoot, 'scripts', 'bc-containers.ps1');
const helperCmd = path.join(repoRoot, 'scripts', 'run-bc-containers-helper.cmd');
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures');

function fixturePath(...parts) {
  return path.join(fixturesRoot, ...parts);
}

function runHelper(args = []) {
  return spawnSync(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperScript, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }
  );
}

function runHelperCmd(args = []) {
  return spawnSync(
    'cmd.exe',
    ['/d', '/c', helperCmd, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    }
  );
}

function parseProtocolJson(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '', 'diagnostics must not leak to process stderr during fixture tests');

  const stdout = result.stdout.trim();
  assert.ok(stdout.startsWith('{'), `stdout must start with JSON object, got: ${stdout}`);
  assert.ok(stdout.endsWith('}'), `stdout must end with JSON object, got: ${stdout}`);
  assert.doesNotThrow(() => JSON.parse(stdout), stdout);
  return JSON.parse(stdout);
}

module.exports = {
  repoRoot,
  helperScript,
  helperCmd,
  fixturePath,
  runHelper,
  runHelperCmd,
  parseProtocolJson
};
