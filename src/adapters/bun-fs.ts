import { mkdir, readdir } from 'node:fs/promises';
import type { FsPort } from '../ports/fs-port';
import { ok, tryCatch, map } from '../shared/result';
import { appError, describeCause } from '../domain/errors';

export const createBunFs = (): FsPort => ({
  readText: (path) =>
    tryCatch(
      () => Bun.file(path).text(),
      (cause) => appError('io', `Could not read ${path}: ${describeCause(cause)}`, { cause }),
    ),

  writeBytes: async (path, bytes) => {
    const r = await tryCatch(
      () => Bun.write(path, bytes),
      (cause) => appError('io', `Could not write ${path}: ${describeCause(cause)}`, { cause }),
    );
    return r.ok ? ok(path) : r;
  },

  ensureDir: async (path) => {
    const r = await tryCatch(
      () => mkdir(path, { recursive: true }),
      (cause) => appError('io', `Could not create directory ${path}: ${describeCause(cause)}`, { cause }),
    );
    return r.ok ? ok(path) : r;
  },

  exists: (path) => Bun.file(path).exists(),

  listDirs: async (path) => {
    const r = await tryCatch(
      () => readdir(path, { withFileTypes: true }),
      (cause) => appError('io', `Could not list ${path}: ${describeCause(cause)}`, { cause }),
    );
    return map(r, (entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name));
  },
});
