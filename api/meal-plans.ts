import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json } from './_lib/http'
import { readJsonFile, writeJsonFile } from './_lib/github'

type MealPlan = {
  plan_meta?: {
    week?: string
    date_range?: string
  }
  [key: string]: unknown
}

type MealPlansDatabase = {
  plans: MealPlan[]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    await listPlans(res)
    return
  }

  if (req.method === 'DELETE') {
    await deletePlan(req, res)
    return
  }

  if (req.method === 'PUT') {
    await upsertPlan(req, res)
    return
  }

  json(res, 405, { error: `Method ${req.method} not allowed` })
}

async function upsertPlan(req: VercelRequest, res: VercelResponse) {
  const incoming = req.body as MealPlan | undefined
  const week = incoming?.plan_meta?.week
  if (!incoming || !week) {
    json(res, 400, { error: 'Missing plan or plan_meta.week' })
    return
  }

  try {
    const database = await readJsonFile<MealPlansDatabase>('MEAL_PLANS.json')
    const nextPlans = [incoming, ...database.plans.filter((plan) => plan.plan_meta?.week !== week)]
    const indexCommit = await writeJsonFile('MEAL_PLANS.json', { plans: nextPlans }, `Update meal plan - ${week}`)
    const fileCommit = await writeJsonFile(`MEAL_PLAN_WEEK_${week}.json`, incoming, `Update meal plan file - ${week}`)
    json(res, 200, { data: incoming, commit: indexCommit, fileCommit })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

async function listPlans(res: VercelResponse) {
  try {
    const database = await readJsonFile<MealPlansDatabase>('MEAL_PLANS.json')
    json(res, 200, { data: database.plans })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

async function deletePlan(req: VercelRequest, res: VercelResponse) {
  const week = String(req.body?.week ?? req.query.week ?? '')
  if (!week) {
    json(res, 400, { error: 'Missing week id' })
    return
  }

  try {
    const database = await readJsonFile<MealPlansDatabase>('MEAL_PLANS.json')
    const nextPlans = database.plans.filter((plan) => plan.plan_meta?.week !== week)
    if (nextPlans.length === database.plans.length) {
      json(res, 404, { error: `No saved meal plan found for ${week}` })
      return
    }

    const commit = await writeJsonFile('MEAL_PLANS.json', { plans: nextPlans }, `Delete meal plan - ${week}`)
    json(res, 200, { deleted: week, data: nextPlans, commit })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}
