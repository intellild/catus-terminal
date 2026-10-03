// Copyright 2026 The Lynxtron Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import { defineConfig } from '@rsbuild/core';
import { pluginLynxtron } from '@lynx-js/lynxtron-dev-plugins/rsbuild';

export default defineConfig({
  environments: {
    desktop: {
      tools: {
        rspack(config, { rspack }) {
          // The preload VM supplies bootstrap __filename/__dirname globals.
          // AutoLink must resolve relative to the emitted application bundle.
          config.plugins ??= [];
          config.plugins.push(
            new rspack.BannerPlugin({
              raw: true,
              banner: `import { fileURLToPath as __catusFileURLToPath } from 'node:url';
const __filename = __catusFileURLToPath(import.meta.url);
const __dirname = __catusFileURLToPath(new URL('.', import.meta.url));`,
            }),
          );
        },
      },
      source: {
        entry: {
          main: './src/main/desktop/main.ts',
          preload: './src/main/desktop/preload.ts',
        },
      },
      plugins: [
        pluginLynxtron({
          args: ['--inspect=9222'],
        }),
      ],
      output: {
        target: 'node',
        distPath: {
          root: './dist/desktop',
        },
        copy: [
          { from: './package.json', to: 'package.json' },
          ...(process.env.NODE_ENV === 'development'
            ? []
            : [{ from: './output/bundle/lynx/', to: '.' }]),
        ],
      },
      dev: {
        writeToDisk: true,
      },
    },
  },
});
