// Vercel serverless function: the deployed dashboard's server side. All logic lives in server/handler.ts.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../server/handler.js';
import { envFrom } from '../server/rules.js';

export default function proxy(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res, envFrom((k) => process.env[k]));
}
