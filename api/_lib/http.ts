import type { VercelRequest, VercelResponse } from '@vercel/node'

export function json(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).json(payload)
}

export function requireMethod(req: VercelRequest, res: VercelResponse, method: string) {
  if (req.method !== method) {
    json(res, 405, { error: `Method ${req.method} not allowed` })
    return false
  }
  return true
}

export function requireTaskSecret(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.TASK_SECRET
  if (!expected) return true
  const header = req.headers.authorization
  if (header !== `Bearer ${expected}`) {
    json(res, 401, { error: 'Invalid task secret' })
    return false
  }
  return true
}
