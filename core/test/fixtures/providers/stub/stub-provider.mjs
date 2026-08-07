#!/usr/bin/env node
// The stub provider: a real process that behaves like a badly-behaved provider
// on demand. Every phase, gate, workflow and journey test runs on this at zero
// quota cost, and M1-M3 never touch a subscription.
//
// It lives under `core/test/fixtures/` and NOT under `core/src/` for one
// concrete reason: the `grandchild-spawner` script must spawn a grandchild, and
// `node:child_process` is importable nowhere in `core/src` except
// `execution/transport-broker.ts`. A stub that needed an exemption from that
// fence would be a stub that weakened the invariant it exists to help test.
//
//   stub-provider.mjs <script> <side-effect-path>
//
// The FIRST thing every script does is create the side-effect file. That file
// is the kill-host proof: if the barrier works, a host killed between
// registration and release leaves a filesystem with no such file anywhere on
// it, because this program never ran.

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SCRIPTS = [
  'success',
  'timeout',
  'silence',
  'overload',
  'malformed',
  'model-line',
  'no-model-line',
  'grandchild-spawner',
];

const script = process.argv[2] ?? '';
const sideEffectPath = process.argv[3] ?? '';

if (!SCRIPTS.includes(script) || sideEffectPath.length === 0) {
  process.stderr.write(`stub-provider: usage: stub-provider.mjs <${SCRIPTS.join('|')}> <side-effect-path>\n`);
  process.exit(64);
}

// Written synchronously, before anything else can fail. `pid` is here so the
// PID-stability proof can compare it against the identity the launcher reported
// BEFORE the exec: same number means `execve` replaced the image, not the task.
const stat = process.platform === 'linux'
  ? fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8').replace(/^.*\)\s/s, '').split(' ')
  : null;
fs.writeFileSync(
  sideEffectPath,
  JSON.stringify({
    script,
    pid: process.pid,
    pgid: stat === null ? process.pid : Number(stat[2]),
    startTime: stat === null ? null : stat[19],
    argv: process.argv.slice(2),
  }),
  { mode: 0o600 },
);

// Real providers write to stderr, and a host that loses it loses the only
// explanation it will get for some failures. Written by every script so the
// transport's stderr is always non-empty and always assertable.
process.stderr.write(`stub-provider: ${script}\n`);

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

/**
 * Reads the prompt off stdin, proving it never rode argv. Scripts that model an
 * unresponsive provider skip this deliberately — a provider that hangs before
 * reading its prompt is exactly what the silence window is for.
 */
function readPrompt() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', () => resolve(text));
  });
}

/** Stays alive until something signals it. The suites cancel these on purpose. */
function stayAlive(onTick) {
  const timer = setInterval(() => onTick?.(), 50);
  timer.unref?.();
  // A second, ref'd timer far in the future keeps the loop alive without
  // spinning: nothing here should exit on its own.
  setTimeout(() => process.exit(0), 10 * 60 * 1_000);
}

switch (script) {
  case 'success':
  case 'model-line':
  case 'no-model-line': {
    const prompt = await readPrompt();
    emit({ type: 'started', script });
    if (script !== 'no-model-line') emit({ type: 'model', model: 'stub-model-1' });
    emit({ type: 'text', text: `prompt:${prompt.length}` });
    emit({ type: 'result', exitCode: 0 });
    process.exit(0);
    break;
  }

  case 'overload': {
    emit({ type: 'started', script });
    emit({ type: 'error', kind: 'overload', message: 'the stub provider is overloaded' });
    process.exit(1);
    break;
  }

  case 'malformed': {
    emit({ type: 'started', script });
    // A truncated object and a bare line: the two shapes a real provider
    // produces when it dies mid-write or prints something conversational.
    process.stdout.write('{"type":"text","text":"half a re\n');
    process.stdout.write('not json at all\n');
    process.exit(0);
    break;
  }

  case 'timeout': {
    // Noisy and endless — trips a hard timeout, and must NOT trip the silence
    // window. The two monitors are different, and this is what proves it.
    emit({ type: 'started', script });
    stayAlive(() => emit({ type: 'text', text: 'still working' }));
    break;
  }

  case 'silence': {
    // Silent and endless. No output, no exit, no prompt read.
    stayAlive();
    break;
  }

  case 'grandchild-spawner': {
    // The grandchild is NOT detached, so it inherits this process group. That is
    // the whole point: `kill(-pgid)` must reach a process the host never saw.
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: false,
    });
    emit({ type: 'started', script });
    emit({ type: 'grandchild', pid: grandchild.pid });
    stayAlive();
    break;
  }
}
