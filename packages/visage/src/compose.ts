import { execFile, spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { clearScreenDown, cursorTo, moveCursor } from 'node:readline';
import {
  stripVTControlCharacters,
  styleText,
  type InspectColor,
} from 'node:util';

import type { Logger, LogLevel } from 'vite';

import type { VisageConfig } from './config.ts';

const Colors: Record<string, InspectColor> = {
  '-': 'dim',
  created: 'blue',
  running: 'green',
  paused: 'cyan',
  restarting: 'yellow',
  removing: 'magenta',
  exited: 'gray',
  dead: 'red',
  healthy: 'green',
  starting: 'yellow',
  unhealthy: 'red',
};

function composeCommand(config: VisageConfig) {
  return {
    compose: [
      'compose',
      '--ansi=never',
      `--file=${config.files.compose}`,
      `--project-name=${config.package
        .toLowerCase()
        .replace(/^[^a-z0-9]+/, '')
        .replace(/[^a-z0-9_-]+/g, '-')}-visage`,
      `--profile=${process.platform}`,
    ],
    opts: {
      cwd: config.cache,
      env: { COMPOSE_MENU: 'false', ...config.secrets, ...process.env },
    },
  };
}

export function startCompose(
  config: VisageConfig,
): () => Promise<ServiceStatus[]> {
  const { compose, opts } = composeCommand(config);
  const dir = join(config.cache, 'logs');
  const out = openSync(join(dir, 'compose.log'), 'a');

  function upSync() {
    const args = [
      ...compose,
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }
  function downSync() {
    const args = [...compose, 'down', '--remove-orphans'];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }

  downSync();
  const result = upSync();
  if (result.error || result.status !== 0) {
    downSync();
    throw result.error ?? new Error('Failed to start Docker Compose');
  }

  function run(...args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      spawn('docker', [...compose, ...args], {
        ...opts,
        stdio: ['ignore', out, out],
      })
        .on('error', reject)
        .on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Failed to stop Docker Compose'));
        });
    });
  }

  return async () => {
    await run('stop');
    try {
      return await getComposeStatus(config);
    } finally {
      await run('down', '--remove-orphans');
    }
  };
}

type ServiceStatus = {
  Service: string;
  Name: string;
  State?: string;
  Health?: string;
  ExitCode?: number;
};

export async function getComposeStatus(
  config: VisageConfig,
  signal?: AbortSignal,
): Promise<ServiceStatus[]> {
  const { compose, opts } = composeCommand(config);
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'docker',
      [...compose, 'ps', '--all', '--format={{json .}}'],
      { ...opts, signal },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });

  return stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length)
    .map((line) => JSON.parse(line));
}

export function formatComposeStatus(
  snapshot: readonly ServiceStatus[],
  widths: number[] = [],
): string {
  if (!snapshot.length) return '  No Visage containers found.';

  type Cell = { text: string; color?: InspectColor };
  const rows: Cell[][] = [
    [
      { text: 'Service' },
      { text: 'State' },
      { text: 'Health' },
      { text: 'Exit' },
    ],
  ];
  for (const container of snapshot) {
    const multiple =
      snapshot.filter((item) => item.Service === container.Service).length > 1;
    const state = container.State || '-';
    const health = container.Health || '-';
    const exit =
      container.State === 'exited' ? String(container.ExitCode ?? '-') : '-';
    rows.push([
      {
        text: multiple
          ? `${container.Service} (${container.Name})`
          : container.Service,
      },
      { text: state, color: Colors[state] },
      { text: health, color: Colors[health] },
      {
        text: exit,
        color: exit === '-' ? 'dim' : exit === '0' ? 'green' : 'yellow',
      },
    ]);
  }
  rows[0].forEach((_, column) => {
    widths[column] = Math.max(
      widths[column] ?? 0,
      ...rows.map((row) => row[column].text.length),
    );
  });
  return rows
    .map((row) => {
      const line = `  ${row
        .map((cell, column) => {
          const text = cell.text.padEnd(widths[column]);
          return cell.color ? styleText(cell.color, text) : text;
        })
        .join('  ')}`;
      const plain = stripVTControlCharacters(line);
      if (process.stdout.isTTY && plain.length >= process.stdout.columns) {
        return plain.slice(0, process.stdout.columns - 1);
      }
      return line;
    })
    .join('\n');
}

function createRenderer(interactive: boolean, logger: Logger) {
  const rows = new Map<string, ServiceStatus>();
  const widths: number[] = [];
  let height = 0;
  return (message: string, snapshot: readonly ServiceStatus[] = []) => {
    if (!interactive) {
      logger.info(message);
      return;
    }
    for (const status of snapshot) rows.set(status.Name, status);
    const lines = rows.size
      ? formatComposeStatus([...rows.values()], widths).split('\n')
      : [];
    const limit = Math.max(1, process.stdout.rows - 2);
    if (lines.length > limit) {
      lines.splice(limit - 1, Infinity, '  …');
    }
    process.stdout.write('\x1b[?2026h');
    cursorTo(process.stdout, 0);
    moveCursor(process.stdout, 0, -height);
    clearScreenDown(process.stdout);
    height = Math.max(height, lines.length + 1);
    const table = lines.length ? `${lines.join('\n')}\n` : '';
    process.stdout.write(
      `${table}${'\n'.repeat(height - lines.length - 1)}${message.slice(0, process.stdout.columns - 1)}\n\x1b[?2026l`,
    );
  };
}

export function withComposeStatus(
  config: VisageConfig,
  stop: () => Promise<ServiceStatus[]>,
  { logger, logLevel = 'info' }: { logger: Logger; logLevel?: LogLevel },
): () => Promise<void> {
  const interactive = process.stdout.isTTY && logLevel === 'info';
  const render = createRenderer(interactive, logger);
  const abort = new AbortController();

  let monitoring: Promise<void> | undefined;
  function monitor() {
    if (monitoring) return;
    monitoring = getComposeStatus(config, abort.signal)
      .then(
        (snapshot) => render('Visage: stopping services…', snapshot),
        () => {},
      )
      .finally(() => (monitoring = undefined));
  }

  return async () => {
    render('Visage: stopping services…');
    const timer = interactive ? setInterval(monitor, 500) : undefined;
    if (interactive) monitor();
    let snapshot: ServiceStatus[];
    try {
      snapshot = await stop();
    } catch (error) {
      if (interactive) render('Visage: stopping services failed.');
      else logger.error('Visage: stopping services failed.');
      throw error;
    } finally {
      clearInterval(timer);
      abort.abort();
      await monitoring;
    }
    render('Visage: services stopped.', snapshot);
  };
}
