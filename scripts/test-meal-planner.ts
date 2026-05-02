// Test standalone du meal planner
// Usage: npx tsx scripts/test-meal-planner.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { generateMealPlan, type MealPlanOptions } from '../src/lib/mealPlanner'
import { normalizeRecipe, type RawRecipe } from '../src/lib/normalize'
import type { BaseBlock, Recipe, ReverseConfig } from '../src/types/health'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')

const recettesRaw = JSON.parse(readFileSync(join(dataDir, 'DATABASE_RECETTES.json'), 'utf-8'))
const configRaw: ReverseConfig = JSON.parse(readFileSync(join(dataDir, 'CONFIG_REVERSE_DIET.json'), 'utf-8'))

type RawBaseBlock = {
  id: string
  nom: string
  type: string
  portion_g: number
  macros: {
    calories_kcal: number
    proteines_g: number
    glucides_g: number
    lipides_g: number
  }
}

const recipes: Recipe[] = (recettesRaw.recettes ?? []).map((r: RawRecipe) => normalizeRecipe(r))
const baseBlocks: BaseBlock[] = (recettesRaw.blocs_base ?? []).map((b: RawBaseBlock) => ({
  id: b.id,
  name: b.nom,
  type: b.type,
  portion_g: b.portion_g,
  macros: {
    kcal: b.macros.calories_kcal,
    protein: b.macros.proteines_g,
    carbs: b.macros.glucides_g,
    fat: b.macros.lipides_g,
  },
}))

console.log(`Loaded ${recipes.length} recipes and ${baseBlocks.length} blocs`)

const scenarios: Array<{ label: string; options: Partial<MealPlanOptions> }> = [
  {
    label: 'Reverse Diet Phase 2 (2150/170/290/65) - Low variety + Carb cycling',
    options: {
      targetKcal: 2150,
      targetMacros: { protein: 170, carbs: 290, fat: 65 },
      variety: 'low',
      carbCycling: true,
      carbCyclingDelta: 30,
    },
  },
  {
    label: 'Reverse Diet Phase 3 (2400/170/330/70) - High variety',
    options: {
      targetKcal: 2400,
      targetMacros: { protein: 170, carbs: 330, fat: 70 },
      variety: 'high',
      carbCycling: false,
      carbCyclingDelta: 0,
    },
  },
  {
    label: 'Cut hypothetical (1800/180/180/60) - Low variety',
    options: {
      targetKcal: 1800,
      targetMacros: { protein: 180, carbs: 180, fat: 60 },
      variety: 'low',
      carbCycling: false,
      carbCyclingDelta: 0,
    },
  },
]

for (const scenario of scenarios) {
  console.log('\n' + '='.repeat(80))
  console.log('SCENARIO: ' + scenario.label)
  console.log('='.repeat(80))

  const options: MealPlanOptions = {
    weekStart: '2026-05-04',
    targetKcal: scenario.options.targetKcal!,
    targetMacros: scenario.options.targetMacros!,
    variety: scenario.options.variety!,
    carbCycling: scenario.options.carbCycling!,
    carbCyclingDelta: scenario.options.carbCyclingDelta!,
    reliabilityFilter: ['sourced', 'partial'],
    trainingSchedule: configRaw.training_schedule,
  }

  const startMs = Date.now()
  const plan = generateMealPlan(options, recipes, baseBlocks)
  const durationMs = Date.now() - startMs

  console.log(`Generated in ${durationMs}ms`)
  console.log(`Targets: ${options.targetKcal} kcal | P ${options.targetMacros.protein}g | C ${options.targetMacros.carbs}g | F ${options.targetMacros.fat}g`)
  console.log()

  let totalKcalErr = 0, totalPErr = 0, totalCErr = 0, totalFErr = 0
  for (const day of plan.days) {
    const t = day.daily_totals
    const dayTarget = day.variance
      ? {
          kcal: t.kcal - day.variance.kcal,
          protein: t.protein - day.variance.protein,
          carbs: t.carbs - day.variance.carbs,
          fat: t.fat - day.variance.fat,
        }
      : {
          kcal: options.targetKcal,
          protein: options.targetMacros.protein,
          carbs: options.targetMacros.carbs,
          fat: options.targetMacros.fat,
        }
    const dKcal = Math.round(t.kcal - dayTarget.kcal)
    const dP = Math.round((t.protein - dayTarget.protein) * 10) / 10
    const dC = Math.round((t.carbs - dayTarget.carbs) * 10) / 10
    const dF = Math.round((t.fat - dayTarget.fat) * 10) / 10
    totalKcalErr += Math.abs(dKcal)
    totalPErr += Math.abs(dP)
    totalCErr += Math.abs(dC)
    totalFErr += Math.abs(dF)
    console.log(`  ${day.day_name.padEnd(9)} ${day.training?.type?.padEnd(12)} | ${t.kcal} kcal (${formatSign(dKcal)}) | P ${t.protein}g (${formatSign(dP)}) | C ${t.carbs}g (${formatSign(dC)}) | F ${t.fat}g (${formatSign(dF)})`)
  }
  console.log()
  console.log(`Avg abs error: ${Math.round(totalKcalErr/7)} kcal | P ${(totalPErr/7).toFixed(1)}g | C ${(totalCErr/7).toFixed(1)}g | F ${(totalFErr/7).toFixed(1)}g`)
  console.log()
  console.log('Day 1 meals:')
  for (const meal of plan.days[0].meals) {
    console.log(`  [${meal.type.padEnd(12)}] ${meal.recipe_name.padEnd(45)} | ${meal.macros.kcal} kcal P${meal.macros.protein} C${meal.macros.carbs} F${meal.macros.fat}`)
  }
}

function formatSign(value: number) {
  if (value === 0) return '±0'
  return value > 0 ? `+${value}` : `${value}`
}
