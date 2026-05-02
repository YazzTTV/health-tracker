import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json, requireMethod } from '../_lib/http.js'
import { listLocalMealPlans, readJsonFile } from '../_lib/github.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'GET')) return
  try {
    const weekId = String(req.query.weekId ?? '').toLowerCase()
    const files = await listLocalMealPlans()
    const match = files.find((file) => file.toLowerCase().includes(weekId))
    if (!match) {
      json(res, 404, { error: `No meal plan found for ${weekId}` })
      return
    }
    const plan = await readJsonFile(match)
    json(res, 200, { data: plan, file: match })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
