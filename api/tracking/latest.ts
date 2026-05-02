import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json, requireMethod } from '../_lib/http'
import { readJsonFile } from '../_lib/github'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return
  try {
    const limit = Number(req.query.limit ?? 7)
    const log = await readJsonFile<{ tracking: unknown[] }>('TRACKING_LOG_2026.json')
    json(res, 200, { data: log.tracking.slice(-limit) })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
