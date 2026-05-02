import recipesRaw from '../../data/DATABASE_RECETTES.json'
import trackingRaw from '../../data/TRACKING_LOG_2026.json'
import configRaw from '../../data/CONFIG_REVERSE_DIET.json'
import { normalizeRecipe, type RawRecipe } from './normalize'
import type { BaseBlock, Recipe, ReverseConfig, TrackingLog } from '../types/health'

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

const recipeArray = Array.isArray(recipesRaw) ? recipesRaw : (recipesRaw as { recettes?: unknown[]; recipes?: unknown[] }).recettes ?? (recipesRaw as { recipes?: unknown[] }).recipes ?? []
const blockArray = Array.isArray(recipesRaw) ? [] : (recipesRaw as { blocs_base?: RawBaseBlock[] }).blocs_base ?? []

export const recipes = recipeArray.map((recipe) => normalizeRecipe(recipe as RawRecipe)) satisfies Recipe[]
export const baseBlocks = blockArray.map((block) => ({
  id: block.id,
  name: block.nom,
  type: block.type,
  portion_g: block.portion_g,
  macros: {
    kcal: block.macros.calories_kcal,
    protein: block.macros.proteines_g,
    carbs: block.macros.glucides_g,
    fat: block.macros.lipides_g,
  },
})) satisfies BaseBlock[]
export const trackingLog = trackingRaw as TrackingLog
export const reverseConfig = configRaw as ReverseConfig
