import { HttpError } from '#/http';
import { env } from 'cloudflare:workers';

export async function requireAuthorization(request: Request): Promise<void> {
  if (!env.OBOIST_SECRET) {
    throw new HttpError(500, 'OBOIST_SECRET is not configured');
  }

  const authorization = request.headers.get('authorization') ?? '';
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

  if (!provided || !(await compareSecrets(provided))) {
    throw new HttpError(401, 'A valid bearer token is required');
  }
}

async function compareSecrets(provided: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.OBOIST_SECRET)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes.at(index) ?? 0) ^ (rightBytes.at(index) ?? 0);
  }

  return difference === 0;
}
