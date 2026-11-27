// Prints a JWT_SIGNING_KEYS line with a fresh ES256 (P-256) key for local development:
//   pnpm keys:generate >> .env
// Production keys come from a secret manager; never commit the output.
import { generateKeyPairSync, randomUUIDv7 } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const kid = `dev-${randomUUIDv7().slice(0, 8)}`;

process.stdout.write(`JWT_SIGNING_KEYS=${JSON.stringify([{ kid, pem }])}\n`);
