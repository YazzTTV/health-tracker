import type { IngredientLine, Recipe } from '../types/health.js'
import { parseIngredientList } from './parseIngredient.js'

type RawRecipe = {
  id?: string
  name?: string
  nom?: string
  categorie?: string
  calories?: number
  macros_par_portion?: {
    calories_kcal?: number
    proteines_g?: number
    glucides_g?: number
    lipides_g?: number
  }
  fiabilite?: string
  macros?: {
    protein?: number
    protein_g?: number
    proteines_g?: number
    carbs?: number
    carbs_g?: number
    glucides_g?: number
    fat?: number
    fat_g?: number
    lipides_g?: number
    calories_kcal?: number
    reliability?: string
    note?: string | null
  }
  ingredients?: string[] | string
  ingredients_structured?: IngredientLine[]
  instructions?: string[] | string | null
  servings?: number
  portions?: number
  macros_source?: string
  meal_type?: string
  tags?: string[]
}

export function normalizeRecipe(raw: RawRecipe): Recipe {
  const ingredients = Array.isArray(raw.ingredients)
    ? raw.ingredients
    : splitMultiline(raw.ingredients)
  const instructions = Array.isArray(raw.instructions)
    ? raw.instructions
    : splitMultiline(raw.instructions)
  const structured = raw.ingredients_structured && raw.ingredients_structured.length
    ? raw.ingredients_structured
    : ingredients.length
      ? parseIngredientList(ingredients)
      : undefined

  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? raw.nom ?? 'Recette sans nom',
    calories: raw.calories ?? raw.macros_par_portion?.calories_kcal ?? raw.macros?.calories_kcal ?? 0,
    macros: {
      protein: raw.macros?.protein ?? raw.macros?.protein_g ?? raw.macros_par_portion?.proteines_g ?? raw.macros?.proteines_g ?? null,
      carbs: raw.macros?.carbs ?? raw.macros?.carbs_g ?? raw.macros_par_portion?.glucides_g ?? raw.macros?.glucides_g ?? null,
      fat: raw.macros?.fat ?? raw.macros?.fat_g ?? raw.macros_par_portion?.lipides_g ?? raw.macros?.lipides_g ?? null,
    },
    ingredients,
    ingredients_structured: structured,
    instructions,
    servings: raw.servings ?? raw.portions ?? 1,
    macros_source: raw.macros_source ?? raw.fiabilite ?? raw.macros?.reliability,
    reliability: raw.fiabilite ?? raw.macros?.reliability,
    note: raw.macros?.note,
    meal_type: raw.meal_type,
    category: raw.categorie,
    tags: raw.tags ?? [],
  }
}

function splitMultiline(value?: string | null) {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export type { RawRecipe }
