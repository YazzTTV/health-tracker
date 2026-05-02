import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json } from './_lib/http'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  json(res, 200, { ok: true, service: 'health-tracker' })
}
