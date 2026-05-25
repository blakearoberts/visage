import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  external: (id) =>
    id === 'vite' ||
    id === 'bcryptjs' ||
    id === 'eta' ||
    id === 'yaml' ||
    id.startsWith('node:'),
  output: {
    file: 'dist/index.js',
    format: 'esm',
  },
  plugins: [typescript({ tsconfig: './tsconfig.build.json' })],
};
