import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json, requireMethod } from '../_lib/http'
import { readJsonFile, writeJsonFile } from '../_lib/github'
import { trackingEntrySchema } from '../_lib/schemas'

type TrackingLog = { tracking: Array<{ date: string; [key: string]: unknown }> }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return
  const parsed = trackingEntrySchema.safeParse(req.body)
  if (!parsed.success) {
    json(res, 400, { error: parsed.error.flatten() })
    return
  }
  try {
    const log = await readJsonFile<TrackingLog>('TRACKING_LOG_2026.json')
    const nextTracking = [...log.tracking.filter((entry) => entry.date !== parsed.data.date), parsed.data].sort((a, b) => a.date.localeCompare(b.date))
    const nextLog = { tracking: nextTracking }
    const commit = await writeJsonFile('TRACKING_LOG_2026.json', nextLog, `Update tracking - ${parsed.data.date}`)
    json(res, 200, { data: parsed.data, commit })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
