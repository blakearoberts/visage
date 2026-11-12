import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import type { Reporter, TestCase } from '@playwright/test/reporter';

export default class LogReporter implements Reporter {
  constructor(private readonly options: { outputFile: string }) {}

  onBegin(): void {
    mkdirSync(dirname(this.options.outputFile), { recursive: true });
    writeFileSync(this.options.outputFile, '');
  }

  onStdOut(chunk: string | Buffer, test: void | TestCase): void {
    this.write('stdout', chunk, test);
  }

  onStdErr(chunk: string | Buffer, test: void | TestCase): void {
    this.write('stderr', chunk, test);
  }

  printsToStdio(): boolean {
    return false;
  }

  private write(
    stream: 'stdout' | 'stderr',
    chunk: string | Buffer,
    test: void | TestCase,
  ): void {
    appendFileSync(
      this.options.outputFile,
      JSON.stringify({
        ts: new Date().toISOString(),
        project: test?.parent.project()?.name,
        stream,
        text: stripVTControlCharacters(chunk.toString()),
      }) + '\n',
    );
  }
}
