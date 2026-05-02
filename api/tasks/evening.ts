import type { VercelRequest, VercelResponse } from '@vercel/node'
import { format } from 'date-fns'
import { json, requireMethod, requireTaskSecret } from '../_lib/http.js'
import { readJsonFile } from '../_lib/github.js'

type Config = { training_schedule: Record<string, { type: string; time?: string }> }

async function postSlack(text: string) {
  if (!process.env.SLACK_WEBHOOK_URL) return { skipped: true }
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  return { ok: response.ok, status: response.status }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return
  if (!requireTaskSecret(req, res)) return
  try {
    const config = await readJsonFile<Config>('CONFIG_REVERSE_DIET.json')
    const day = format(new Date(), 'eeee').toLowerCase()
    const training = config.training_schedule[day]
    if (!training || training.type === 'Rest') {
      json(res, 200, { task: 'training_feedback', skipped: true, reason: 'Rest day' })
      return
    }
    const slack = await postSlack(`22:00 - Feedback ${training.type}: énergie, performance, difficulté, calories approximatives ?`)
    json(res, 200, { task: 'training_feedback', training, slack })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
