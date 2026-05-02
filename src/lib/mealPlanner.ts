import type { BaseBlock, MealPlan, MealPlanDay, MealPlanMeal, Recipe, ReverseConfig, TrainingEntry } from '../types/health'

export type MacroSet = { kcal: number; protein: number; carbs: number; fat: number }
type MacroLocks = { protein: boolean; carbs: boolean; fat: boolean }

export type MealPlanOptions = {
  weekStart: string
  targetKcal: number
  targetMacros: { protein: number; carbs: number; fat: number }
  variety: 'low' | 'high'
  carbCycling: boolean
  carbCyclingDelta: number
  reliabilityFilter: Array<'sourced' | 'partial' | 'estimated'>
  trainingSchedule: ReverseConfig['training_schedule']
  avoidRecipeIds?: string[]
}

type RecipeBundle = {
  pdj: Recipe
  repas1: Recipe
  repas2: Recipe
  dessert: Recipe
}

type ScoredCombo = {
  bundle: RecipeBundle
  score: number
}

const SCORE_WEIGHTS = { kcal: 1, protein: 4, carbs: 2, fat: 4 } as const
const TRIALS_PER_DAY = 700
const TRIALS_LOW_VARIETY = 1800
const AVOIDED_RECIPE_PENALTY = 420
const WEEKLY_REPEAT_PENALTY = 260
const SAME_DAY_CATEGORY_REPEAT_PENALTY = 180
const ELITE_COMBO_COUNT = 18
const MACRO_KCAL_TOLERANCE = 80
const BLOCK_SOLVER_BEAM_SIZE = 10
const BLOCK_SOLVER_CANDIDATE_LIMIT = 42
const MAX_BLOCK_ADJUSTMENTS = 3

const ZERO_MACROS: MacroSet = { kcal: 0, protein: 0, carbs: 0, fat: 0 }

export function generateMealPlan(
  options: MealPlanOptions,
  recipes: Recipe[],
  baseBlocks: BaseBlock[],
): MealPlan {
  const filteredRecipes = filterRecipes(recipes, options.reliabilityFilter)
  const breakfasts = filteredRecipes.filter((r) => r.category === 'petit_dej')
  const mains = filteredRecipes.filter((r) => r.category === 'repas_principal')
  const desserts = filteredRecipes.filter((r) => r.category === 'dessert')
  const snacks = buildSnackPool(breakfasts, desserts)

  if (!breakfasts.length || mains.length < 2 || !desserts.length) {
    throw new Error('Pas assez de recettes après filtrage. Désactive le filtre fiabilité.')
  }

  const normalizedBaseTargets = normalizeMacroTargets({
    kcal: options.targetKcal,
    protein: options.targetMacros.protein,
    carbs: options.targetMacros.carbs,
    fat: options.targetMacros.fat,
  })
  const macroLocks = getMacroLocks(normalizedBaseTargets)
  const baselineCarbs = normalizedBaseTargets.carbs
  const days = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addDaysIso(options.weekStart, dayIndex)
    const weekday = getWeekdayKey(date)
    const training = options.trainingSchedule[weekday] ?? { type: 'Rest', duration_minutes: 0 }
    const dayTargets = computeDayTargets(normalizedBaseTargets, baselineCarbs, macroLocks, options, training)
    return { date, training, targets: dayTargets }
  })

  let dayCombos: Array<RecipeBundle>

  if (options.variety === 'low') {
    const sharedBundle = findBestBundle(
      averageTargets(days.map((d) => d.targets)),
      breakfasts,
      mains,
      desserts,
      baseBlocks,
      TRIALS_LOW_VARIETY,
      options.avoidRecipeIds ?? [],
      new Map(),
      macroLocks,
    )
    dayCombos = days.map(() => sharedBundle.bundle)
  } else {
    const weeklyUsage = new Map<string, number>()
    dayCombos = days.map((day) => {
      const result = findBestBundle(
        day.targets,
        breakfasts,
        mains,
        desserts,
        baseBlocks,
        TRIALS_PER_DAY,
        options.avoidRecipeIds ?? [],
        weeklyUsage,
        macroLocks,
      )
      countBundleUsage(weeklyUsage, result.bundle)
      return result.bundle
    })
  }

  const planDays: MealPlanDay[] = days.map((day, index) => {
    const bundle = dayCombos[index]
    const initialMeals = bundleToMeals(bundle)
    const swappedMeals = smartReplaceRecipes(initialMeals, day.targets, baseBlocks, macroLocks, {
      petit_dej: breakfasts,
      repas_principal: mains,
      dessert: desserts,
      collation: snacks,
    }, options.avoidRecipeIds ?? [])
    const expandedMeals = expandRecipePortions(swappedMeals, day.targets, baseBlocks, macroLocks, options.avoidRecipeIds ?? [])
    const recipeMeals = addCollationBeforeBlocks(expandedMeals, day.targets, baseBlocks, macroLocks, snacks, options.avoidRecipeIds ?? [])
    const subtotal = sumMeals(recipeMeals)
    const gap = subtractMacros(day.targets, subtotal)
    const adjustments = solveBlocs(gap, baseBlocks, macroLocks)
    const meals = [...recipeMeals, ...adjustments]
    const dailyTotals = sumMeals(meals)
    const variance = computeVariance(dailyTotals, day.targets, macroLocks)

    return {
      date: day.date,
      day_name: getDayName(day.date),
      training: day.training,
      meals,
      daily_totals: roundMacroSet(dailyTotals),
      note: `Cible : ${Math.round(day.targets.kcal)} kcal · P ${Math.round(day.targets.protein)}g · C ${Math.round(day.targets.carbs)}g · F ${Math.round(day.targets.fat)}g`,
      variance: roundMacroSet(variance),
    }
  })

  return {
    plan_meta: {
      week: `generated-${options.weekStart}`,
      date_range: `${planDays[0].date} to ${planDays.at(-1)?.date}`,
      phase: 'generated',
      target_kcal: options.targetKcal,
      target_macros: options.targetMacros,
      note: buildPlanNote(options, normalizedBaseTargets),
    },
    days: planDays,
  }
}

function filterRecipes(recipes: Recipe[], reliabilityFilter: MealPlanOptions['reliabilityFilter']) {
  if (!reliabilityFilter.length) return recipes
  return recipes.filter((recipe) => {
    const r = (recipe.reliability ?? recipe.macros_source ?? 'estimated') as 'sourced' | 'partial' | 'estimated'
    return reliabilityFilter.includes(r)
  })
}

function normalizeMacroTargets(targets: MacroSet): MacroSet {
  const locks = getMacroLocks(targets)
  if (!locks.protein || !locks.carbs || !locks.fat) return targets

  const macroKcal = macroCalories(targets)
  if (Math.abs(macroKcal - targets.kcal) <= MACRO_KCAL_TOLERANCE) return targets

  const kcalAfterProteinAndFat = targets.kcal - targets.protein * 4 - targets.fat * 9
  if (kcalAfterProteinAndFat <= 0) return targets

  return {
    ...targets,
    carbs: roundDecimal(kcalAfterProteinAndFat / 4),
  }
}

function macroCalories(targets: MacroSet) {
  return targets.protein * 4 + targets.carbs * 4 + targets.fat * 9
}

function getMacroLocks(targets: MacroSet): MacroLocks {
  return {
    protein: targets.protein > 0,
    carbs: targets.carbs > 0,
    fat: targets.fat > 0,
  }
}

function computeDayTargets(
  baseTargets: MacroSet,
  baselineCarbs: number,
  macroLocks: MacroLocks,
  options: MealPlanOptions,
  training: TrainingEntry,
): MacroSet {
  if (!options.carbCycling || !macroLocks.carbs) return baseTargets

  const isHighCarbDay = isIntenseTraining(training)
  const isLowCarbDay = isRestDay(training)
  let carbsAdj = 0
  if (isHighCarbDay) carbsAdj = options.carbCyclingDelta
  else if (isLowCarbDay) carbsAdj = -options.carbCyclingDelta

  const newCarbs = Math.max(80, baselineCarbs + carbsAdj)
  const kcalDelta = (newCarbs - baselineCarbs) * 4

  return {
    kcal: baseTargets.kcal + kcalDelta,
    protein: baseTargets.protein,
    carbs: newCarbs,
    fat: baseTargets.fat,
  }
}

function isIntenseTraining(training?: TrainingEntry) {
  if (!training) return false
  const t = (training.type ?? '').toLowerCase()
  if (!t || t === 'rest') return false
  const minutes = training.duration_minutes ?? 0
  if (t.includes('jjb') || t.includes('mma') || t.includes('grappling')) return true
  if (t.includes('musculation') && minutes >= 90) return true
  return false
}

function isRestDay(training?: TrainingEntry) {
  if (!training) return true
  const t = (training.type ?? '').toLowerCase()
  return !t || t === 'rest'
}

function averageTargets(targetsList: MacroSet[]): MacroSet {
  const sum = targetsList.reduce<MacroSet>(
    (acc, t) => ({
      kcal: acc.kcal + t.kcal,
      protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs,
      fat: acc.fat + t.fat,
    }),
    ZERO_MACROS,
  )
  const n = targetsList.length || 1
  return { kcal: sum.kcal / n, protein: sum.protein / n, carbs: sum.carbs / n, fat: sum.fat / n }
}

function findBestBundle(
  targets: MacroSet,
  breakfasts: Recipe[],
  mains: Recipe[],
  desserts: Recipe[],
  blocs: BaseBlock[],
  trials: number,
  avoidRecipeIds: string[],
  weeklyUsage: Map<string, number>,
  macroLocks: MacroLocks,
): ScoredCombo {
  let best: ScoredCombo | null = null
  const elite: ScoredCombo[] = []
  const avoided = new Set(avoidRecipeIds)

  for (let i = 0; i < trials; i++) {
    const pdj = pickRandom(breakfasts)
    const repas1 = pickRandom(mains)
    const repas2 = pickRandomExcluding(mains, repas1.id)
    const dessert = pickRandom(desserts)
    const bundle = { pdj, repas1, repas2, dessert }
    const recipeMacros = sumRecipes([pdj, repas1, repas2, dessert])
    const gap = subtractMacros(targets, recipeMacros)
    const blocsMeals = solveBlocs(gap, blocs, macroLocks)
    const blocsMacros = sumMeals(blocsMeals)
    const finalMacros = addMacros(recipeMacros, blocsMacros)
    const recipes = [pdj, repas1, repas2, dessert]
    const score = scoreMacros(finalMacros, targets) +
      recipeAvoidancePenalty(recipes, avoided) +
      weeklyDiversityPenalty(recipes, weeklyUsage) +
      sameDayCategoryPenalty(recipes)

    if (!best || score < best.score) {
      best = { bundle, score }
    }
    pushElite(elite, { bundle, score })
  }

  if (!best) throw new Error('Échec de la génération.')
  return pickEliteCombo(elite) ?? best
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function pickRandomExcluding(items: Recipe[], excludedId: string): Recipe {
  if (items.length <= 1) return items[0]
  let candidate: Recipe
  do {
    candidate = pickRandom(items)
  } while (candidate.id === excludedId)
  return candidate
}

function sumRecipes(recipes: Recipe[]): MacroSet {
  return recipes.reduce<MacroSet>(
    (acc, recipe) => ({
      kcal: acc.kcal + recipe.calories,
      protein: acc.protein + (recipe.macros.protein ?? 0),
      carbs: acc.carbs + (recipe.macros.carbs ?? 0),
      fat: acc.fat + (recipe.macros.fat ?? 0),
    }),
    ZERO_MACROS,
  )
}

function sumMeals(meals: MealPlanMeal[]): MacroSet {
  return meals.reduce<MacroSet>(
    (acc, meal) => ({
      kcal: acc.kcal + meal.macros.kcal,
      protein: acc.protein + meal.macros.protein,
      carbs: acc.carbs + meal.macros.carbs,
      fat: acc.fat + meal.macros.fat,
    }),
    ZERO_MACROS,
  )
}

function subtractMacros(a: MacroSet, b: MacroSet): MacroSet {
  return {
    kcal: a.kcal - b.kcal,
    protein: a.protein - b.protein,
    carbs: a.carbs - b.carbs,
    fat: a.fat - b.fat,
  }
}

function addMacros(a: MacroSet, b: MacroSet): MacroSet {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  }
}

function computeVariance(actual: MacroSet, target: MacroSet, macroLocks: MacroLocks): MacroSet {
  return {
    kcal: actual.kcal - target.kcal,
    protein: macroLocks.protein ? actual.protein - target.protein : 0,
    carbs: macroLocks.carbs ? actual.carbs - target.carbs : 0,
    fat: macroLocks.fat ? actual.fat - target.fat : 0,
  }
}

function scoreMacros(actual: MacroSet, target: MacroSet): number {
  const kcalDiff = Math.abs(actual.kcal - target.kcal)
  const locks = getMacroLocks(target)
  const pDiff = locks.protein ? Math.abs(actual.protein - target.protein) : 0
  const cDiff = locks.carbs ? Math.abs(actual.carbs - target.carbs) : 0
  const fDiff = locks.fat ? Math.abs(actual.fat - target.fat) : 0
  const pPenalty = actual.protein < target.protein ? pDiff * 1.6 : pDiff * 1.15
  const fPenalty = actual.fat < target.fat ? fDiff * 1.8 : fDiff
  return (
    kcalDiff * SCORE_WEIGHTS.kcal +
    pPenalty * SCORE_WEIGHTS.protein +
    cDiff * SCORE_WEIGHTS.carbs +
    fPenalty * SCORE_WEIGHTS.fat
  )
}

type RecipePools = {
  petit_dej: Recipe[]
  repas_principal: Recipe[]
  dessert: Recipe[]
  collation: Recipe[]
}

function slotCategory(slotType: string): keyof RecipePools | null {
  if (slotType === 'petit_dej') return 'petit_dej'
  if (slotType === 'repas_1' || slotType === 'repas_2') return 'repas_principal'
  if (slotType === 'dessert') return 'dessert'
  if (slotType === 'collation') return 'collation'
  return null
}

function buildSnackPool(breakfasts: Recipe[], desserts: Recipe[]) {
  return [...desserts, ...breakfasts]
    .filter((recipe) => recipe.calories >= 80 && recipe.calories <= 520)
    .sort((a, b) => a.calories - b.calories)
}

function smartReplaceRecipes(
  meals: MealPlanMeal[],
  targets: MacroSet,
  blocs: BaseBlock[],
  macroLocks: MacroLocks,
  pools: RecipePools,
  avoidRecipeIds: string[],
): MealPlanMeal[] {
  let current = meals.map((meal) => ({ ...meal, macros: { ...meal.macros } }))
  let currentScore = scorePlanWithAdjustments(current, targets, blocs, macroLocks, avoidRecipeIds)

  for (let pass = 0; pass < 3; pass++) {
    let bestSwap: { meals: MealPlanMeal[]; score: number } | null = null

    for (let index = 0; index < current.length; index++) {
      const meal = current[index]
      const category = slotCategory(meal.type)
      if (!category) continue

      const usedIds = new Set(current.filter((_, i) => i !== index).map((item) => item.recipe_id))
      const candidates = pools[category].filter((recipe) => !usedIds.has(recipe.id) && recipe.id !== meal.recipe_id)

      for (const recipe of candidates) {
        const candidateMeals = current.map((item, itemIndex) => itemIndex === index ? recipeToMeal(recipe, meal.type) : item)
        const candidateScore = scorePlanWithAdjustments(candidateMeals, targets, blocs, macroLocks, avoidRecipeIds)
        if (candidateScore < currentScore && (!bestSwap || candidateScore < bestSwap.score)) {
          bestSwap = { meals: candidateMeals, score: candidateScore }
        }
      }
    }

    if (!bestSwap) break
    current = bestSwap.meals
    currentScore = bestSwap.score
  }

  return current
}

function expandRecipePortions(meals: MealPlanMeal[], targets: MacroSet, blocs: BaseBlock[], macroLocks: MacroLocks, avoidRecipeIds: string[]): MealPlanMeal[] {
  let expanded = meals.map((meal) => ({ ...meal, macros: { ...meal.macros } }))
  let currentScore = scorePlanWithAdjustments(expanded, targets, blocs, macroLocks, avoidRecipeIds)

  for (let step = 0; step < 4; step++) {
    const currentTotals = sumMeals(expanded)
    if (targets.kcal - currentTotals.kcal < 180) break

    let bestCandidate: { meals: MealPlanMeal[]; score: number } | null = null

    for (let index = 0; index < expanded.length; index++) {
      const meal = expanded[index]
      if (!['petit_dej', 'repas_1', 'repas_2', 'dessert'].includes(meal.type)) continue
      if (meal.servings >= 2) continue

      const candidate = expanded.map((item, itemIndex) => itemIndex === index ? increaseRecipeServing(item, 0.5) : item)
      const candidateTotals = sumMeals(candidate)
      if (candidateTotals.kcal > targets.kcal + 120) continue

      const candidateScore = scorePlanWithAdjustments(candidate, targets, blocs, macroLocks, avoidRecipeIds)
      if (candidateScore < currentScore && (!bestCandidate || candidateScore < bestCandidate.score)) {
        bestCandidate = { meals: candidate, score: candidateScore }
      }
    }

    if (!bestCandidate) break
    expanded = bestCandidate.meals
    currentScore = bestCandidate.score
  }

  return expanded
}

function addCollationBeforeBlocks(
  meals: MealPlanMeal[],
  targets: MacroSet,
  blocs: BaseBlock[],
  macroLocks: MacroLocks,
  snacks: Recipe[],
  avoidRecipeIds: string[],
): MealPlanMeal[] {
  const currentTotals = sumMeals(meals)
  const gap = subtractMacros(targets, currentTotals)
  if (gap.kcal < 120 &&
    (!macroLocks.carbs || gap.carbs < 25) &&
    (!macroLocks.protein || gap.protein < 12) &&
    (!macroLocks.fat || gap.fat < 6)) return meals

  const usedIds = new Set(meals.map((meal) => meal.recipe_id))
  const currentScore = scorePlanWithAdjustments(meals, targets, blocs, macroLocks, avoidRecipeIds)
  let best: { meals: MealPlanMeal[]; score: number } | null = null

  for (const snack of snacks) {
    if (usedIds.has(snack.id)) continue
    const candidateMeals = [...meals, recipeToMeal(snack, 'collation')]
    const candidateTotals = sumMeals(candidateMeals)
    if (candidateTotals.kcal > targets.kcal + 140) continue

    const candidateScore = scorePlanWithAdjustments(candidateMeals, targets, blocs, macroLocks, avoidRecipeIds)
    if (candidateScore < currentScore && (!best || candidateScore < best.score)) {
      best = { meals: candidateMeals, score: candidateScore }
    }
  }

  return best ? best.meals : meals
}

function scorePlanWithAdjustments(recipeMeals: MealPlanMeal[], targets: MacroSet, blocs: BaseBlock[], macroLocks: MacroLocks, avoidRecipeIds: string[] = []) {
  const gap = subtractMacros(targets, sumMeals(recipeMeals))
  const adjustments = solveBlocs(gap, blocs, macroLocks)
  const adjustedTotals = addMacros(sumMeals(recipeMeals), sumMeals(adjustments))
  const adjustmentPenalty = adjustments.reduce((total, meal) => total + meal.macros.kcal * 0.8, 0)
  const avoided = new Set(avoidRecipeIds)
  const avoidancePenalty = recipeMeals.reduce((total, meal) => total + (avoided.has(meal.recipe_id) ? AVOIDED_RECIPE_PENALTY : 0), 0)
  return scoreMacros(adjustedTotals, targets) + adjustmentPenalty + avoidancePenalty
}

function recipeAvoidancePenalty(recipes: Recipe[], avoided: Set<string>) {
  return recipes.reduce((total, recipe) => total + (avoided.has(recipe.id) ? AVOIDED_RECIPE_PENALTY : 0), 0)
}

function weeklyDiversityPenalty(recipes: Recipe[], weeklyUsage: Map<string, number>) {
  return recipes.reduce((total, recipe) => total + (weeklyUsage.get(recipe.id) ?? 0) * WEEKLY_REPEAT_PENALTY, 0)
}

function sameDayCategoryPenalty(recipes: Recipe[]) {
  const namesByCategory = new Map<string, Set<string>>()
  let penalty = 0
  recipes.forEach((recipe) => {
    const category = recipe.category ?? 'unknown'
    const nameKey = normalizeRecipeNameForDiversity(recipe.name)
    const names = namesByCategory.get(category) ?? new Set<string>()
    if (names.has(nameKey)) penalty += SAME_DAY_CATEGORY_REPEAT_PENALTY
    names.add(nameKey)
    namesByCategory.set(category, names)
  })
  return penalty
}

function normalizeRecipeNameForDiversity(name: string) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(proteine|proteiné|protéiné|protein|healthy|fit)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function countBundleUsage(usage: Map<string, number>, bundle: RecipeBundle) {
  ;[bundle.pdj, bundle.repas1, bundle.repas2, bundle.dessert].forEach((recipe) => {
    usage.set(recipe.id, (usage.get(recipe.id) ?? 0) + 1)
  })
}

function pushElite(elite: ScoredCombo[], combo: ScoredCombo) {
  elite.push(combo)
  elite.sort((a, b) => a.score - b.score)
  if (elite.length > ELITE_COMBO_COUNT) elite.length = ELITE_COMBO_COUNT
}

function pickEliteCombo(elite: ScoredCombo[]) {
  if (!elite.length) return null
  const bestScore = elite[0].score
  const candidates = elite.filter((item) => item.score <= bestScore * 1.08 + 60)
  return pickRandom(candidates.length ? candidates : elite.slice(0, 4))
}

function solveBlocs(gap: MacroSet, blocs: BaseBlock[], macroLocks: MacroLocks): MealPlanMeal[] {
  const candidates = buildBlockCandidates(gap, blocs, macroLocks)
  if (!candidates.length) return []

  type SolverState = { meals: MealPlanMeal[]; totals: MacroSet; score: number }
  let beam: SolverState[] = [{ meals: [], totals: ZERO_MACROS, score: scoreBlockTotals(ZERO_MACROS, gap, macroLocks) }]
  let best = beam[0]

  for (let depth = 0; depth < MAX_BLOCK_ADJUSTMENTS; depth++) {
    const next: SolverState[] = []

    for (const state of beam) {
      for (const candidate of candidates) {
        if (state.meals.some((meal) => meal.recipe_id === candidate.recipe_id)) continue
        const totals = addMacros(state.totals, candidate.macros)
        const score = scoreBlockTotals(totals, gap, macroLocks)
        next.push({ meals: [...state.meals, candidate], totals, score })
      }
    }

    if (!next.length) break
    next.sort((a, b) => a.score - b.score)
    beam = next.slice(0, BLOCK_SOLVER_BEAM_SIZE)
    if (beam[0].score < best.score) best = beam[0]
  }

  return best.meals
}

function buildBlockCandidates(gap: MacroSet, blocs: BaseBlock[], macroLocks: MacroLocks) {
  const usefulGaps = {
    kcal: Math.max(0, gap.kcal),
    protein: macroLocks.protein ? Math.max(0, gap.protein) : 0,
    carbs: macroLocks.carbs ? Math.max(0, gap.carbs) : 0,
    fat: macroLocks.fat ? Math.max(0, gap.fat) : 0,
  }

  const candidates: MealPlanMeal[] = []

  for (const bloc of blocs) {
    if (bloc.macros.kcal <= 0) continue
    if (!blockHelpsGap(bloc, usefulGaps)) continue

    const maxMultiplier = maxBlockMultiplier(bloc, usefulGaps, macroLocks)
    for (let multiplier = 0.5; multiplier <= maxMultiplier; multiplier += 0.5) {
      candidates.push(blocToMeal(bloc, multiplier, blockSlotType(bloc)))
    }
  }

  return candidates
    .sort((a, b) => scoreBlockTotals(a.macros, gap, macroLocks) - scoreBlockTotals(b.macros, gap, macroLocks))
    .slice(0, BLOCK_SOLVER_CANDIDATE_LIMIT)
}

function blockHelpsGap(bloc: BaseBlock, gap: MacroSet) {
  return (
    (gap.protein > 5 && bloc.macros.protein > 5) ||
    (gap.carbs > 10 && bloc.macros.carbs > 8) ||
    (gap.fat > 4 && bloc.macros.fat > 4) ||
    (gap.kcal > 120 && bloc.macros.kcal > 80)
  )
}

function maxBlockMultiplier(bloc: BaseBlock, gap: MacroSet, macroLocks: MacroLocks) {
  const byType = bloc.type === 'proteine' ? 5 : bloc.type === 'lipide' ? 4 : bloc.type === 'glucide' ? 3 : 2
  const byKcal = gap.kcal > 0 ? (gap.kcal + 90) / bloc.macros.kcal : 1
  const macroCaps = [
    macroLocks.protein && bloc.macros.protein > 0 && gap.protein > 0 ? (gap.protein + 18) / bloc.macros.protein : byType,
    macroLocks.carbs && bloc.macros.carbs > 0 && gap.carbs > 0 ? (gap.carbs + 25) / bloc.macros.carbs : byType,
    macroLocks.fat && bloc.macros.fat > 0 && gap.fat > 0 ? (gap.fat + 8) / bloc.macros.fat : byType,
  ]
  return clampHalf(Math.max(0.5, Math.min(byType, byKcal, ...macroCaps)), 0.5, byType)
}

function blockSlotType(bloc: BaseBlock) {
  if (bloc.type === 'fruit') return 'collation'
  if (bloc.id === 'bloc_023' || /whey/i.test(bloc.name)) return 'whey'
  if (bloc.type === 'proteine') return 'proteine'
  if (bloc.type === 'lipide') return 'lipide'
  if (bloc.type === 'glucide') return 'glucide'
  return 'ajustement'
}

function scoreBlockTotals(actual: MacroSet, gap: MacroSet, macroLocks: MacroLocks) {
  const kcalDiff = Math.abs(actual.kcal - Math.max(0, gap.kcal))
  const proteinDiff = macroLocks.protein ? Math.abs(actual.protein - Math.max(0, gap.protein)) : 0
  const carbsDiff = macroLocks.carbs ? Math.abs(actual.carbs - Math.max(0, gap.carbs)) : 0
  const fatDiff = macroLocks.fat ? Math.abs(actual.fat - Math.max(0, gap.fat)) : 0
  const overshootPenalty =
    Math.max(0, actual.kcal - gap.kcal - 70) * 1.4 +
    (macroLocks.protein ? Math.max(0, actual.protein - gap.protein - 12) * 7 : 0) +
    (macroLocks.carbs ? Math.max(0, actual.carbs - gap.carbs - 18) * 4 : 0) +
    (macroLocks.fat ? Math.max(0, actual.fat - gap.fat - 6) * 9 : 0)

  return (
    kcalDiff * 0.9 +
    proteinDiff * 5 +
    carbsDiff * 2.5 +
    fatDiff * 7 +
    overshootPenalty +
    actual.kcal * 0.08
  )
}

function blocToMeal(bloc: BaseBlock, multiplier: number, slotType: string): MealPlanMeal {
  const grams = Math.round(bloc.portion_g * multiplier)
  return {
    type: slotType,
    recipe_id: bloc.id,
    recipe_name: `${bloc.name} (${grams}g)`,
    servings: multiplier,
    macros: {
      kcal: Math.round(bloc.macros.kcal * multiplier),
      protein: roundDecimal(bloc.macros.protein * multiplier),
      carbs: roundDecimal(bloc.macros.carbs * multiplier),
      fat: roundDecimal(bloc.macros.fat * multiplier),
    },
  }
}

function increaseRecipeServing(meal: MealPlanMeal, extraServing: number): MealPlanMeal {
  const nextServings = roundDecimal(meal.servings + extraServing)
  const factor = nextServings / meal.servings
  return {
    ...meal,
    recipe_name: formatScaledRecipeName(meal.recipe_name, nextServings),
    servings: nextServings,
    macros: {
      kcal: Math.round(meal.macros.kcal * factor),
      protein: roundDecimal(meal.macros.protein * factor),
      carbs: roundDecimal(meal.macros.carbs * factor),
      fat: roundDecimal(meal.macros.fat * factor),
    },
  }
}

function formatScaledRecipeName(name: string, servings: number) {
  const baseName = name.replace(/\s+\(x\d+(?:\.\d+)?\)$/, '')
  return servings === 1 ? baseName : `${baseName} (x${servings})`
}

function clampHalf(value: number, min: number, max: number) {
  const halfStep = Math.round(value * 2) / 2
  return Math.max(min, Math.min(max, halfStep))
}

function roundDecimal(value: number) {
  return Math.round(value * 10) / 10
}

function roundMacroSet(set: MacroSet): MacroSet {
  return {
    kcal: Math.round(set.kcal),
    protein: roundDecimal(set.protein),
    carbs: roundDecimal(set.carbs),
    fat: roundDecimal(set.fat),
  }
}

function bundleToMeals(bundle: RecipeBundle): MealPlanMeal[] {
  return [
    recipeToMeal(bundle.pdj, 'petit_dej'),
    recipeToMeal(bundle.repas1, 'repas_1'),
    recipeToMeal(bundle.repas2, 'repas_2'),
    recipeToMeal(bundle.dessert, 'dessert'),
  ]
}

function recipeToMeal(recipe: Recipe, slotType: string): MealPlanMeal {
  return {
    type: slotType,
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    servings: 1,
    macros: {
      kcal: recipe.calories,
      protein: recipe.macros.protein ?? 0,
      carbs: recipe.macros.carbs ?? 0,
      fat: recipe.macros.fat ?? 0,
    },
  }
}

function buildPlanNote(options: MealPlanOptions, normalizedTargets: MacroSet) {
  const parts: string[] = []
  const locks = getMacroLocks({
    kcal: options.targetKcal,
    protein: options.targetMacros.protein,
    carbs: options.targetMacros.carbs,
    fat: options.targetMacros.fat,
  })
  parts.push(`Variété : ${options.variety === 'low' ? 'low (4 recettes pour 7 jours)' : 'high (recettes différentes par jour)'}`)
  if (options.carbCycling) {
    parts.push(`Carb cycling ON (±${options.carbCyclingDelta}g)`)
  } else {
    parts.push('Carb cycling OFF')
  }
  if (options.reliabilityFilter.length) {
    parts.push(`Filtre : ${options.reliabilityFilter.join(' + ')}`)
  }
  const freeMacros = [
    !locks.protein ? 'protéines' : null,
    !locks.carbs ? 'glucides' : null,
    !locks.fat ? 'lipides' : null,
  ].filter(Boolean)
  if (freeMacros.length) {
    parts.push(`Macros libres : ${freeMacros.join(' + ')}`)
  } else if (Math.abs(macroCalories({
    kcal: options.targetKcal,
    protein: options.targetMacros.protein,
    carbs: options.targetMacros.carbs,
    fat: options.targetMacros.fat,
  }) - options.targetKcal) > MACRO_KCAL_TOLERANCE) {
    parts.push(`Cibles ajustées : ${Math.round(normalizedTargets.kcal)} kcal · P ${Math.round(normalizedTargets.protein)}g · C ${Math.round(normalizedTargets.carbs)}g · F ${Math.round(normalizedTargets.fat)}g`)
  }
  return parts.join(' · ')
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatLocalIsoDate(date)
}

function getDayName(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })
}

function getWeekdayKey(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
}

function formatLocalIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
