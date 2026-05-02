import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json, requireMethod } from '../_lib/http.js'
import { readJsonFile, writeJsonFile } from '../_lib/github.js'
import { mealPlanGenerateSchema } from '../_lib/schemas.js'
import { generateMealPlan } from '../../src/lib/mealPlanner.js'
import { normalizeRecipe, type RawRecipe } from '../../src/lib/normalize.js'
import type { BaseBlock, MealPlan } from '../../src/types/health.js'

type RawMacros = {
  calories_kcal?: number | null
  proteines_g?: number | null
  glucides_g?: number | null
  lipides_g?: number | null
}

type RawBaseBlock = {
  id: string
  nom: string
  type: string
  portion_g: number
  macros: RawMacros
}

type Database = {
  recettes?: RawRecipe[]
  recipes?: RawRecipe[]
  blocs_base?: RawBaseBlock[]
}

type MealPlanDatabase = {
  plans: MealPlan[]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireMethod(req, res, 'POST')) return
  const parsed = mealPlanGenerateSchema.safeParse(req.body)
  if (!parsed.success) {
    json(res, 400, { error: parsed.error.flatten() })
    return
  }

  try {
    const raw = await readJsonFile<RawRecipe[] | Database>('DATABASE_RECETTES.json')
    const recipesRaw = Array.isArray(raw) ? raw : raw.recettes ?? raw.recipes ?? []
    const baseBlocksRaw = Array.isArray(raw) ? [] : raw.blocs_base ?? []
    const preferences = parsed.data.preferences
    const planDatabase = await readJsonFile<MealPlanDatabase>('MEAL_PLANS.json')

    const plan = generateMealPlan(
      {
        weekStart: parsed.data.week_start,
        targetKcal: parsed.data.target_kcal,
        targetMacros: parsed.data.target_macros,
        variety: preferences?.variety ?? 'high',
        carbCycling: preferences?.carb_cycling ?? false,
        carbCyclingDelta: preferences?.carb_cycling_delta ?? 0,
        reliabilityFilter: preferences?.reliability ?? ['sourced', 'partial', 'estimated'],
        trainingSchedule: parsed.data.training_schedule ?? {},
        avoidRecipeIds: collectRecentRecipeIds(planDatabase.plans, preferences?.no_repetition_days ?? 21),
      },
      recipesRaw.map((recipe) => normalizeRecipe(recipe)),
      normalizeBaseBlocks(baseBlocksRaw),
    )

    const fileName = `MEAL_PLAN_WEEK_${plan.plan_meta.week}.json`
    const nextPlans = [plan, ...planDatabase.plans.filter((item) => String(item.plan_meta.week) !== String(plan.plan_meta.week))]
    const indexCommit = await writeJsonFile('MEAL_PLANS.json', { plans: nextPlans }, `Save meal plan - ${plan.plan_meta.week}`)
    const fileCommit = await writeJsonFile(fileName, plan, `Generate meal plan - ${plan.plan_meta.week}`)
    json(res, 200, { data: plan, file: fileName, commit: indexCommit, fileCommit })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

function normalizeBaseBlocks(blocks: RawBaseBlock[]): BaseBlock[] {
  return blocks.map((block) => ({
    id: block.id,
    name: block.nom,
    type: block.type,
    portion_g: block.portion_g,
    macros: {
      kcal: block.macros.calories_kcal ?? 0,
      protein: block.macros.proteines_g ?? 0,
      carbs: block.macros.glucides_g ?? 0,
      fat: block.macros.lipides_g ?? 0,
    },
  }))
}

function collectRecentRecipeIds(plans: MealPlan[], limitDays: number) {
  const ids = new Set<string>()
  let remainingDays = limitDays

  for (const plan of plans) {
    for (const day of plan.days) {
      if (remainingDays <= 0) return [...ids]
      day.meals.forEach((meal) => {
        if (!meal.recipe_id.startsWith('bloc_')) ids.add(meal.recipe_id)
      })
      remainingDays -= 1
    }
  }

  return [...ids]
}
