import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseIngredientList } from '../src/lib/parseIngredient'

type RawRecipe = {
  id?: string
  nom?: string
  ingredients?: string | string[]
  ingredients_structured?: unknown
  [key: string]: unknown
}

type Database = {
  recettes?: RawRecipe[]
  recipes?: RawRecipe[]
  [key: string]: unknown
}

const TARGET_PATH = path.resolve(process.cwd(), 'data/DATABASE_RECETTES.json')

async function main() {
  const raw = await fs.readFile(TARGET_PATH, 'utf8')
  const database = JSON.parse(raw) as Database
  const recipes = database.recettes ?? database.recipes ?? []

  let totalLines = 0
  let scalableLines = 0
  let sectionLines = 0
  let unscalableLines = 0
  let recipesUpdated = 0

  for (const recipe of recipes) {
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients
      : (recipe.ingredients ?? '').split('\n').map((line: string) => line.trim()).filter(Boolean)

    if (!ingredients.length) continue

    const parsed = parseIngredientList(ingredients)
    recipe.ingredients_structured = parsed
    recipesUpdated += 1

    for (const line of parsed) {
      totalLines += 1
      if (line.kind === 'section') sectionLines += 1
      else if (line.scalable) scalableLines += 1
      else unscalableLines += 1
    }
  }

  await fs.writeFile(TARGET_PATH, JSON.stringify(database, null, 2) + '\n')

  console.log('Migration ingredients_structured terminée.')
  console.log(`Recettes mises à jour : ${recipesUpdated}`)
  console.log(`Lignes totales        : ${totalLines}`)
  console.log(`Sections              : ${sectionLines}`)
  console.log(`Scalables             : ${scalableLines} (${pct(scalableLines, totalLines)})`)
  console.log(`Non scalables         : ${unscalableLines} (${pct(unscalableLines, totalLines)})`)
}

function pct(part: number, total: number) {
  if (!total) return '0%'
  return `${Math.round((part / total) * 1000) / 10}%`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
