import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Plugin } from 'prettier';
import * as yamlPlugin from 'prettier/plugins/yaml';

const documentType = 'helm-template';
const yamlParser = yamlPlugin.parsers.yaml;
const yamlPrinter = yamlPlugin.printers.yaml;

type HelmDocument = {
  type: typeof documentType;
  text: string;
};

const isHelmDocument = (node: unknown): node is HelmDocument =>
  typeof node === 'object' &&
  node !== null &&
  'type' in node &&
  node.type === documentType;

const isHelmTemplate = (filePath: string) => {
  let directory = dirname(filePath);
  while (true) {
    if (
      basename(directory) === 'templates' &&
      existsSync(join(dirname(directory), 'Chart.yaml'))
    ) {
      return true;
    }

    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};

export const parsers = {
  yaml: {
    ...yamlParser,
    parse(text, options) {
      return isHelmTemplate(options.filepath)
        ? { type: documentType, text }
        : yamlParser.parse(text, options);
    },
    locStart(node) {
      return isHelmDocument(node) ? 0 : yamlParser.locStart(node);
    },
    locEnd(node) {
      return isHelmDocument(node) ? node.text.length : yamlParser.locEnd(node);
    },
  },
} satisfies NonNullable<Plugin['parsers']>;

export const printers = {
  yaml: {
    ...yamlPrinter,
    preprocess(ast, options) {
      return isHelmDocument(ast) ? ast : yamlPrinter.preprocess!(ast, options);
    },
    embed(path, options) {
      return isHelmDocument(path.node)
        ? null
        : yamlPrinter.embed!(path, options);
    },
    print(path, options, print) {
      return isHelmDocument(path.node)
        ? path.node.text
        : yamlPrinter.print(path, options, print);
    },
    getVisitorKeys(node, nonTraversableKeys) {
      return isHelmDocument(node)
        ? []
        : yamlPrinter.getVisitorKeys!(node, nonTraversableKeys);
    },
  },
} satisfies NonNullable<Plugin['printers']>;
