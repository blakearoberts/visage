import { request } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { e2eEnv, packageRoot } from './environment';
import {
  externalIdpDirectPort,
  externalIdpPort,
  harnessRoot,
  managedDexPort,
  manifestFile,
  sharedDirectPort,
  type HarnessManifest,
} from './harness';

type HarnessProcess = {
  readonly name: string;
  readonly child: ChildProcess;
  readonly logFile: string;
};

export default async function globalSetup(): Promise<() => Promise<void>> {
  rmSync(harnessRoot, { recursive: true, force: true });
  mkdirSync(harnessRoot, { recursive: true, mode: 0o700 });

  const processes: HarnessProcess[] = [];

  const manifest = {
    simple: {
      appUrl: `https://localhost:${managedDexPort}/simple/`,
      directUrl: `http://127.0.0.1:${sharedDirectPort}/simple/`,
    },
    ssr: {
      appUrl: `https://localhost:${managedDexPort}/ssr/`,
      directUrl: `http://127.0.0.1:${sharedDirectPort}/ssr/`,
    },
    externalIdp: {
      appUrl: `https://localhost:${externalIdpPort}/external-idp/`,
      directUrl: `http://127.0.0.1:${externalIdpDirectPort}/external-idp/`,
    },
  } satisfies HarnessManifest;

  try {
    processes.push(
      startHarnessProcess('managed-dex', 'managed-dex-harness.ts'),
    );
    await waitForApp(manifest.simple.appUrl, processes);
    await waitForApp(manifest.ssr.appUrl, processes);

    processes.push(
      startHarnessProcess('external-idp', 'external-idp-harness.ts'),
    );
    await waitForApp(manifest.externalIdp.appUrl, processes);
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    await stopHarnessProcesses(processes);
    throw error;
  }

  return async () => {
    await stopHarnessProcesses(processes);
  };
}

function startHarnessProcess(name: string, scriptName: string): HarnessProcess {
  const cwd = join(harnessRoot, name);
  const logFile = join(cwd, 'process.log');
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  writeFileSync(logFile, '');

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(packageRoot, 'test/e2e', scriptName)],
    {
      cwd,
      env: e2eEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (chunk) => appendFileSync(logFile, chunk));
  child.stderr?.on('data', (chunk) => appendFileSync(logFile, chunk));

  return { name, child, logFile };
}

async function waitForApp(
  appUrl: string,
  processes: readonly HarnessProcess[],
): Promise<void> {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const timeout = Date.now() + 60_000;
  let lastError: unknown;

  try {
    while (Date.now() < timeout) {
      assertHarnessProcessesRunning(processes);

      try {
        const response = await context.get(appUrl, {
          maxRedirects: 0,
          timeout: 5_000,
        });
        if (response.status() < 500) return;
        lastError = `Unexpected ${response.status()} from ${appUrl}`;
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    await context.dispose();
  }

  throw new Error(
    `Timed out waiting for ${appUrl}\n${formatHarnessState(
      processes,
    )}\n${String(lastError ?? '')}`,
  );
}

function assertHarnessProcessesRunning(
  processes: readonly HarnessProcess[],
): void {
  const exited = processes.find((process) => process.child.exitCode !== null);
  if (exited === undefined) return;

  throw new Error(
    `${exited.name} harness exited with ${exited.child.exitCode}\n${tail(
      exited.logFile,
    )}`,
  );
}

async function stopHarnessProcesses(
  processes: readonly HarnessProcess[],
): Promise<void> {
  await Promise.all(processes.map(stopHarnessProcess));
}

async function stopHarnessProcess(process: HarnessProcess): Promise<void> {
  if (process.child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      process.child.kill('SIGKILL');
      resolve();
    }, 5_000);

    process.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    process.child.kill('SIGTERM');
  });
}

function formatHarnessState(processes: readonly HarnessProcess[]): string {
  return processes
    .map((process) => `--- ${process.name} ---\n${tail(process.logFile)}`)
    .join('\n');
}

function tail(file: string): string {
  return readFileSync(file, 'utf8').split(/\r?\n/).slice(-80).join('\n');
}
