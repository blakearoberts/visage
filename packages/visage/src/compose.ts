import { execFile, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { styleText, type InspectColor } from 'node:util';

import type { VisageConfig } from './config';

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

export function startCompose(config: VisageConfig): () => void {
  const { compose, opts } = composeCommand(config);
  const dir = join(config.cache, 'logs');

  function up() {
    const out = openSync(join(dir, 'compose.log'), 'a');
    const args = [
      ...compose,
      'up',
      '--detach',
      '--force-recreate',
      '--remove-orphans',
    ];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }
  function down() {
    const out = openSync(join(dir, 'compose.log'), 'a');
    const args = [...compose, 'down', '--remove-orphans'];
    return spawnSync('docker', args, { ...opts, stdio: ['ignore', out, out] });
  }

  down();
  const result = up();
  if (result.error || result.status !== 0) {
    down();
    throw result.error ?? new Error('Failed to start Docker Compose');
  }
  return down;
}

export async function getComposeStatus(config: VisageConfig): Promise<string> {
  const { compose, opts } = composeCommand(config);
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      'docker',
      [...compose, 'ps', '--all', '--format={{json .}}'],
      opts,
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });

  type ComposeContainer = {
    Service: string;
    Name: string;
    State?: string;
    Health?: string;
    ExitCode?: number;
  };
  const containers: ComposeContainer[] = stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length)
    .map((line) => JSON.parse(line));
  if (!containers.length) return '  No Visage containers found.';

  type Cell = { text: string; color?: InspectColor };
  const rows: Cell[][] = [
    [
      { text: 'Service' },
      { text: 'State' },
      { text: 'Health' },
      { text: 'Exit' },
    ],
  ];
  for (const container of containers) {
    const multiple =
      containers.filter((item) => item.Service === container.Service).length >
      1;
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
  const widths = rows[0].map((_, column) => {
    return Math.max(...rows.map((row) => row[column].text.length));
  });
  return rows
    .map(
      (row) =>
        `  ${row
          .map((cell, column) => {
            const text = cell.text.padEnd(widths[column]);
            return cell.color ? styleText(cell.color, text) : text;
          })
          .join('  ')}`,
    )
    .join('\n');
}
