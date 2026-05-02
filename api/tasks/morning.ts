import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json, requireMethod, requireTaskSecret } from '../_lib/http'

async function postSlack(text: string) {
  if (!process.env.SLACK_WEBHOOK_URL) return { skipped: true }
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  return { ok: response.ok, status: response.status }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return
  if (!requireTaskSecret(req, res)) return
  try {
    const date = new Date().toISOString().slice(0, 10)
    const slack = await postSlack(`08:30 - Poids du matin ? Réponds puis log dans Health Tracker. Date: ${date}`)
    json(res, 200, { task: 'weight_check', date, slack })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
