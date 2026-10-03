import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const rustRoot = fileURLToPath(new URL('../native', import.meta.url));
// Cargo/cxx's source symlink must not form
// a cycle beneath a directory scanned by the desktop JS build.
export const rustTarget =
  process.env.CATUS_RUST_TARGET_DIR ??
  `/tmp/catus-native-${createHash('sha256').update(rustRoot).digest('hex').slice(0, 12)}`;
