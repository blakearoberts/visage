import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { format } from 'prettier';

import * as plugin from '../index.ts';

test('preserves Helm templates without affecting other YAML', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'prettier-plugin-helm-'));
  const chart = join(directory, 'chart');
  const template = join(chart, 'templates', 'deployment.yaml');
  t.after(() => rm(directory, { recursive: true }));

  await mkdir(dirname(template), { recursive: true });
  await writeFile(join(chart, 'Chart.yaml'), 'apiVersion: v2\n');

  const helm = 'image: {{ .Values.image }}\n';
  const yaml = 'name:    example\n';

  assert.equal(
    await format(helm, { filepath: template, plugins: [plugin] }),
    helm,
  );
  assert.equal(
    await format(yaml, {
      filepath: join(directory, 'templates', 'deployment.yaml'),
      plugins: [plugin],
    }),
    'name: example\n',
  );
});
