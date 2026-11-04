// Copyright 2026 The Lynxtron Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { defineConfig } from '@lynx-js/rspeedy';

import { pluginLynxConfig } from '@lynx-js/config-rsbuild-plugin';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { compilerOptionsKeys, configKeys } from '@lynx-js/type-config';
import type { CompilerOptions, Config } from '@lynx-js/type-config';
import { pluginTypeCheck } from '@rsbuild/plugin-type-check';
import { pluginRspeedyDevReady } from '@lynx-js/lynxtron-dev-plugins/rspeedy';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { parse as parseToml } from 'smol-toml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = process.cwd();
console.log('rootPath: ', path.resolve(rootPath, './src/assets'));
export default defineConfig({
  source: {
    // These packages publish modern JS that Lynx's main VM needs downleveled.
    include: [
      /node_modules[\\/]@formatjs[\\/]/,
      /node_modules[\\/]@lynx-js[\\/]preact-devtools[\\/]/,
      /node_modules[\\/]effect[\\/]/,
      /node_modules[\\/]@effect[\\/]atom-react[\\/]/,
    ],
  },
  server: {
    port: process.env.CATUS_WEB === '1' ? 5970 : 5969,
  },
  resolve: {
    alias: {
      '@assets': path.resolve(rootPath, './src/assets'),
      react$: '@lynx-js/react',
    },
  },
  output: {
    filename: '[name].[platform].bundle',
  },
  tools: {
    rspack(config) {
      config.module ??= {};
      config.module.rules ??= [];
      // Compile translation files into resource objects; no TOML parser in Lynx.
      config.module.rules.push({ test: /\.toml$/, type: 'json', parser: { parse: parseToml } });
      // Lynx UI publishes JSX with sideEffects:false. Preserve generated
      // MTS snapshot registrations even for components only mounted in BTS.
      config.module.rules.push({
        test: /[\\/]@lynx-js[\\/]lynx-ui-[^\\/]+[\\/]/,
        sideEffects: true,
      });
    },
  },
  environments: {
    web: {
      source: { entry: { main: './src/app/web/index.tsx' } },
      output: { distPath: { root: './dist/web' } },
      resolve: {
        alias: {
          [path.resolve(rootPath, 'src/app/runtime.ts')]: path.resolve(
            rootPath,
            'src/app/web/runtime.ts',
          ),
          [path.resolve(rootPath, 'src/app/components/terminal/panel-placeholder.tsx')]:
            path.resolve(rootPath, 'src/app/web/session-content.tsx'),
          [path.resolve(rootPath, 'src/app/components/terminal/session-content.tsx')]: path.resolve(
            rootPath,
            'src/app/web/session-content.tsx',
          ),
        },
      },
    },
    lynx: {
      source: {
        entry: {
          main: './src/app/index.tsx',
        },
      },
      output: {
        assetPrefix: new URL('./dist/desktop/', pathToFileURL(__dirname + path.sep)).toString(),
        distPath: {
          root: './output/bundle/lynx',
        },
      },
    },
  },
  plugins: [
    pluginLynxConfig(
      {
        alignMouseEventWithW3C: true,
        enableCSSInheritance: true,
        enableCSSInlineVariables: true,
      },
      {
        configKeys: [...configKeys, 'alignMouseEventWithW3C'],
        compilerOptionsKeys,
        validate: (input) =>
          input as Config &
            CompilerOptions & {
              alignMouseEventWithW3C: boolean;
            },
      },
    ),
    pluginReactLynx({
      enableCSSInheritance: true,
    }),
    pluginTypeCheck(),
    ...(process.env.CATUS_WEB === '1' ? [] : [pluginRspeedyDevReady()]),
  ],
});
