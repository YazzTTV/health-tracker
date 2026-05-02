import type { VercelRequest, VercelResponse } from '@vercel/node'
import { json } from './_lib/http'
import { readJsonFile, writeJsonFile } from './_lib/github'
import { recipeCreateSchema } from './_lib/schemas'
import { parseIngredientList } from '../src/lib/parseIngredient'

type RecipeDatabase = {
  metadata?: { [key: string]: unknown }
  stats?: {
    total_recettes?: number
    par_categorie?: Record<string, number>
    fiabilite?: Record<string, number>
    [key: string]: unknown
  }
  recettes: RawRecipe[]
  recipes?: RawRecipe[]
  blocs_base?: unknown[]
  plans_repas?: unknown[]
}

type RawRecipe = {
  id?: string
  name?: string
  nom?: string
  categorie?: string
  calories?: number
  portions?: number
  meal_type?: string
  ingredients?: string[] | string
  instructions?: string[] | string | null
  macros_par_portion?: {
    calories_kcal?: number
    proteines_g?: number
    glucides_g?: number
    lipides_g?: number
  }
  macros_totales?: {
    calories_kcal?: number
    proteines_g?: number
    glucides_g?: number
    lipides_g?: number
  }
  fiabilite?: 'sourced' | 'partial' | 'estimated' | string
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
    reliability?: 'sourced' | 'partial' | 'estimated' | string
    sourced_fields?: Record<string, boolean>
    note?: string | null
  }
  [key: string]: unknown
}

function normalize(raw: RawRecipe) {
  return {
    ...raw,
    name: raw.name ?? raw.nom,
    calories: raw.calories ?? raw.macros_par_portion?.calories_kcal ?? raw.macros?.calories_kcal ?? 0,
    macros: {
      protein: raw.macros?.protein ?? raw.macros?.protein_g ?? raw.macros_par_portion?.proteines_g ?? raw.macros?.proteines_g ?? null,
      carbs: raw.macros?.carbs ?? raw.macros?.carbs_g ?? raw.macros_par_portion?.glucides_g ?? raw.macros?.glucides_g ?? null,
      fat: raw.macros?.fat ?? raw.macros?.fat_g ?? raw.macros_par_portion?.lipides_g ?? raw.macros?.lipides_g ?? null,
      reliability: raw.fiabilite ?? raw.macros?.reliability,
      note: raw.macros?.note,
    },
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    await createRecipe(req, res)
    return
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: `Method ${req.method} not allowed` })
    return
  }

  try {
    const raw = await readJsonFile<RawRecipe[] | RecipeDatabase>('DATABASE_RECETTES.json')
    const recipes = (Array.isArray(raw) ? raw : raw.recettes ?? raw.recipes ?? []).map(normalize)
    const search = String(req.query.search ?? '').toLowerCase()
    const mealType = String(req.query.meal_type ?? '')
    const category = String(req.query.categorie ?? '')
    const maxKcal = req.query.max_kcal ? Number(req.query.max_kcal) : null
    const filtered = recipes.filter((recipe) => !search || String(recipe.name ?? '').toLowerCase().includes(search)).filter((recipe) => !mealType || recipe.meal_type === mealType).filter((recipe) => !category || recipe.categorie === category).filter((recipe) => !maxKcal || recipe.calories <= maxKcal)
    json(res, 200, { data: filtered })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

async function createRecipe(req: VercelRequest, res: VercelResponse) {
  const parsed = recipeCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    json(res, 400, { error: parsed.error.flatten() })
    return
  }

  try {
    const database = await readJsonFile<RecipeDatabase>('DATABASE_RECETTES.json')
    const recipes = database.recettes ?? database.recipes ?? []
    const nextId = getNextRecipeId(recipes)
    const ingredientLines = parsed.data.ingredients.split('\n').map((line: string) => line.trim()).filter(Boolean)
    const recipe: RawRecipe = {
      id: nextId,
      nom: parsed.data.nom,
      categorie: parsed.data.categorie,
      portions: 1,
      ingredients: parsed.data.ingredients,
      ingredients_structured: parseIngredientList(ingredientLines),
      instructions: parsed.data.instructions?.trim() || null,
      macros_par_portion: {
        calories_kcal: parsed.data.calories_kcal,
        proteines_g: parsed.data.proteines_g,
        glucides_g: parsed.data.glucides_g,
        lipides_g: parsed.data.lipides_g,
      },
      macros_totales: {
        calories_kcal: parsed.data.calories_kcal,
        proteines_g: parsed.data.proteines_g,
        glucides_g: parsed.data.glucides_g,
        lipides_g: parsed.data.lipides_g,
      },
      fiabilite: parsed.data.reliability,
      note: parsed.data.note?.trim() || null,
    }

    const nextDatabase = {
      ...database,
      stats: updateStats(database.stats, parsed.data.reliability, parsed.data.categorie),
      recettes: [...recipes, recipe],
    }
    const commit = await writeJsonFile('DATABASE_RECETTES.json', nextDatabase, `Add recipe - ${parsed.data.nom}`)
    json(res, 201, { data: normalize(recipe), raw: recipe, commit })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

function getNextRecipeId(recipes: RawRecipe[]) {
  const max = recipes.reduce((highest, recipe) => {
    const match = recipe.id?.match(/rcp_(\d+)/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `rcp_${String(max + 1).padStart(3, '0')}`
}

function updateStats(stats: RecipeDatabase['stats'], reliability: 'sourced' | 'partial' | 'estimated', category: 'petit_dej' | 'repas_principal' | 'dessert') {
  return {
    ...stats,
    total_recettes: (stats?.total_recettes ?? 0) + 1,
    par_categorie: {
      ...(stats?.par_categorie ?? {}),
      [category]: (stats?.par_categorie?.[category] ?? 0) + 1,
    },
    fiabilite: {
      ...(stats?.fiabilite ?? {}),
      [reliability]: (stats?.fiabilite?.[reliability] ?? 0) + 1,
    },
  }
}
