import type { Result } from '../shared/result';

export type FsPort = {
  readonly readText: (path: string) => Promise<Result<string>>;
  readonly writeBytes: (path: string, bytes: Uint8Array) => Promise<Result<string>>;
  readonly ensureDir: (path: string) => Promise<Result<string>>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly listDirs: (path: string) => Promise<Result<ReadonlyArray<string>>>;
};
