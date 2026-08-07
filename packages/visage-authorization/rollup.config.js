import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  external: (id) => id === 'jose' || id.startsWith('node:'),
  output: {
    file: 'dist/index.js',
    format: 'esm',
  },
  plugins: [typescript({ tsconfig: './tsconfig.build.json' })],
};
