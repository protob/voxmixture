import { ok, err, tryCatch, type Result } from '../shared/result';
import { appError, describeCause } from '../domain/errors';
import type { Provider } from '../domain/config';

const ENV: Record<Provider, { key: string; file: string }> = {
  openai: { key: 'OPENAI_API_KEY', file: 'OPENAI_API_KEY_FILE' },
  elevenlabs: { key: 'ELEVENLABS_API_KEY', file: 'ELEVENLABS_API_KEY_FILE' },
};

// Env var first, then *_API_KEY_FILE pointing at a secret file (secret-manager paths
// stay in the owner's env, never in code).
export const loadApiKey = async (provider: Provider): Promise<Result<string>> => {
  const { key, file } = ENV[provider];
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim().length > 0) return ok(fromEnv.trim());

  const filePath = process.env[file];
  if (filePath) {
    const read = await tryCatch(
      () => Bun.file(filePath).text(),
      (cause) => appError('config', `Could not read ${file}=${filePath}: ${describeCause(cause)}`, { cause }),
    );
    return read.ok ? ok(read.data.trim()) : read;
  }
  return err(appError('config', `Missing ${key} (or ${file} pointing at a key file)`));
};
