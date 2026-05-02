import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Bell, Dumbbell, Flame, LineChart, Plus, Search, Settings, Utensils, Weight, X } from 'lucide-react'
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Title, Tooltip } from 'chart.js'
import { Line } from 'react-chartjs-2'
import { baseBlocks, recipes as initialRecipes, reverseConfig, trackingLog } from './lib/localData'
import { byDate, entriesWithWeight, latestEntry, macroCompletion, rangeEntries, sevenDayAverage, weeklyWeightAverages } from './lib/metrics'
import { generateMealPlan, type MealPlanOptions } from './lib/mealPlanner'
import { buildScaledLines } from './lib/parseIngredient'
import type { BaseBlock, IngredientLine, MealPlan, Recipe, TrackingEntry } from './types/health'
import './index.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

type Page = 'dashboard' | 'progress' | 'recipes' | 'meals' | 'log' | 'settings'

type NavItem = { id: Page; label: string; icon: typeof BarChart3 }

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'progress', label: 'Progression', icon: LineChart },
  { id: 'recipes', label: 'Recettes', icon: Search },
  { id: 'meals', label: 'Meal plan', icon: Utensils },
  { id: 'log', label: 'Log quotidien', icon: Plus },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function App() {
  const [page, setPage] = useState<Page>(() => readPageCache())
  const [entries, setEntries] = useState<TrackingEntry[]>(trackingLog.tracking)
  const sortedEntries = useMemo(() => byDate(entries), [entries])
  const latest = latestEntry(sortedEntries)
  const latestWeight = entriesWithWeight(sortedEntries).at(-1)
  const avg7 = sevenDayAverage(sortedEntries)
  const currentPhase = Object.values(reverseConfig.phases)[0]
  const currentTargets = currentPhase.macros

  useEffect(() => {
    writePageCache(page)
  }, [page])

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Health Tracking</p>
          <h1>Noah OS</h1>
          <p className="muted">Poids, calories, recettes et accountability. Objectif 70 kg sans refaire le yo-yo.</p>
        </div>
        <nav className="nav-list" aria-label="Navigation principale">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="callout">
          <Bell size={18} />
          <span>Rappels prévus : 08:30 poids, 22:00 feedback entraînement.</span>
        </div>
      </aside>

      <section className="content">
        {page === 'dashboard' && <Dashboard latest={latest} latestWeight={latestWeight} avg7={avg7} entries={sortedEntries} targets={currentTargets} />}
        {page === 'progress' && <Progress entries={sortedEntries} />}
        {page === 'recipes' && <Recipes />}
        {page === 'meals' && <MealPlans />}
        {page === 'log' && <DailyLog entries={entries} onEntriesChange={setEntries} />}
        {page === 'settings' && <SettingsPage />}
      </section>
    </main>
  )
}

function Dashboard({ latest, latestWeight, avg7, entries, targets }: { latest?: TrackingEntry; latestWeight?: TrackingEntry; avg7: number | null; entries: TrackingEntry[]; targets: { protein: number; carbs: number; fat: number } }) {
  const [chartRange, setChartRange] = useState<'30d' | '3m' | '1y' | 'all'>('30d')
  const chartEntries = chartRange === 'all'
    ? entries
    : rangeEntries(entries, chartRange === '30d' ? 30 : chartRange === '3m' ? 90 : 365)
  const chartData = toChartData(chartEntries)
  const todayMacros = latest?.macros_actual

  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Aujourd'hui</p>
        <h2>Tableau de bord</h2>
        <p className="muted">La métrique utile est la tendance 7 jours, pas le bruit quotidien.</p>
      </header>

      <div className="grid cards-4">
        <MetricCard icon={Weight} label="Dernier poids" value={latestWeight?.weight_kg ? `${latestWeight.weight_kg} kg` : 'Non loggé'} helper={latestWeight?.date ?? 'Aucune date'} />
        <MetricCard icon={LineChart} label="Moyenne 7 jours" value={avg7 ? `${avg7} kg` : 'TBD'} helper="Signal principal" />
        <MetricCard icon={Flame} label="Calories" value={latest?.calories_estimated ? `${latest.calories_estimated} kcal` : 'Non loggé'} helper="Estimation jour" />
        <MetricCard icon={Dumbbell} label="Training" value={latest?.training?.type ?? 'Rest'} helper={latest?.training?.duration_minutes ? `${latest.training.duration_minutes} min` : 'Durée TBD'} />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{chartRangeLabel(chartRange)}</p>
            <h3>Poids et calories</h3>
          </div>
          <div className="range-tabs" aria-label="Période du graphique">
            {(['30d', '3m', '1y', 'all'] as const).map((range) => (
              <button key={range} className={chartRange === range ? 'active' : ''} onClick={() => setChartRange(range)}>
                {chartRangeButtonLabel(range)}
              </button>
            ))}
          </div>
        </div>
        <Line data={chartData} options={chartOptions} />
      </section>

      <section className="grid cards-3">
        <MacroBar label="Protéines" value={todayMacros?.protein} target={targets.protein} />
        <MacroBar label="Glucides" value={todayMacros?.carbs} target={targets.carbs} />
        <MacroBar label="Lipides" value={todayMacros?.fat} target={targets.fat} />
      </section>
    </div>
  )
}

function Progress({ entries }: { entries: TrackingEntry[] }) {
  const ranges = [
    { label: '30 jours', data: rangeEntries(entries, 30) },
    { label: '3 mois', data: rangeEntries(entries, 90) },
    { label: '1 an', data: rangeEntries(entries, 365) },
  ]
  const weekly = weeklyWeightAverages(entries)

  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Tendances</p>
        <h2>Progression</h2>
        <p className="muted">Trois vues pour séparer le court terme, la phase reverse diet et le trend annuel.</p>
      </header>
      {ranges.map((range) => (
        <section className="panel" key={range.label}>
          <div className="panel-heading">
            <h3>{range.label}</h3>
            <span className="pill">{range.data.length} entrées</span>
          </div>
          <Line data={toChartData(range.data)} options={chartOptions} />
        </section>
      ))}
      <section className="panel">
        <h3>Moyennes hebdo</h3>
        <div className="table-list">
          {weekly.slice(-12).map((item) => (
            <div className="table-row" key={item.week}>
              <span>{item.week}</span>
              <strong>{item.weight} kg</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Recipes() {
  const [query, setQuery] = useState('')
  const [maxKcal, setMaxKcal] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [recipeList, setRecipeList] = useState<Recipe[]>(initialRecipes)
  const filtered = recipeList
    .filter((recipe) => recipe.name.toLowerCase().includes(query.toLowerCase()))
    .filter((recipe) => !maxKcal || recipe.calories <= Number(maxKcal))
    .slice(0, 40)

  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Base recettes</p>
        <h2>{recipeList.length} recettes</h2>
        <p className="muted">Recherche, détail recette et ajout manuel dans la base `DATABASE_RECETTES.json`.</p>
      </header>
      <AddRecipeForm onRecipeCreated={(recipe) => setRecipeList((current) => [...current, recipe])} />
      <section className="filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="riz, poulet, skyr..." />
        <input value={maxKcal} onChange={(event) => setMaxKcal(event.target.value)} placeholder="kcal max" type="number" />
      </section>
      <section className="recipe-grid">
        {filtered.map((recipe) => (
          <button className="recipe-card recipe-card-button" key={recipe.id} onClick={() => setSelectedRecipe(recipe)}>
            <div className="panel-heading">
              <h3>{recipe.name}</h3>
              <span className="pill">{recipe.calories} kcal</span>
            </div>
            {recipe.category ? <p className="eyebrow">{recipe.category.replace('_', ' ')}</p> : null}
            <p className="muted">P {recipe.macros.protein ?? 0}g · C {recipe.macros.carbs ?? 0}g · F {recipe.macros.fat ?? 0}g</p>
            <p className="small">{recipe.ingredients.slice(0, 2).join(' ') || 'Ingrédients à compléter'}</p>
            <span className="recipe-card-cta">Voir la recette</span>
          </button>
        ))}
      </section>
      {selectedRecipe && <RecipeDetail recipe={selectedRecipe} onClose={() => setSelectedRecipe(null)} />}
    </div>
  )
}

type RecipeFormState = {
  nom: string
  categorie: 'petit_dej' | 'repas_principal' | 'dessert'
  ingredients: string
  instructions: string
  calories_kcal: string
  proteines_g: string
  glucides_g: string
  lipides_g: string
  reliability: 'sourced' | 'partial' | 'estimated'
  note: string
}

function AddRecipeForm({ onRecipeCreated }: { onRecipeCreated: (recipe: Recipe) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [form, setForm] = useState<RecipeFormState>({
    nom: '',
    categorie: 'repas_principal',
    ingredients: '',
    instructions: '',
    calories_kcal: '',
    proteines_g: '',
    glucides_g: '',
    lipides_g: '',
    reliability: 'estimated',
    note: '',
  })

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('Ajout en cours...')

    const payload = {
      nom: form.nom.trim(),
      categorie: form.categorie,
      ingredients: form.ingredients.trim(),
      instructions: form.instructions.trim() || null,
      calories_kcal: Number(form.calories_kcal),
      proteines_g: Number(form.proteines_g),
      glucides_g: Number(form.glucides_g),
      lipides_g: Number(form.lipides_g),
      reliability: form.reliability,
      note: form.note.trim() || null,
    }

    try {
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (!response.ok) {
        setStatus(typeof result.error === 'string' ? result.error : 'Ajout refusé par l’API.')
        return
      }

      onRecipeCreated({
        id: result.data.id,
        name: result.data.name,
        calories: result.data.calories,
        macros: result.data.macros,
        ingredients: payload.ingredients.split('\n').map((line) => line.trim()).filter(Boolean),
        instructions: (payload.instructions ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
        servings: 1,
        macros_source: payload.reliability,
        reliability: payload.reliability,
        category: payload.categorie,
        note: payload.note,
      })
      setForm({ nom: '', categorie: 'repas_principal', ingredients: '', instructions: '', calories_kcal: '', proteines_g: '', glucides_g: '', lipides_g: '', reliability: 'estimated', note: '' })
      setStatus('Recette ajoutée à DATABASE_RECETTES.json.')
    } catch {
      setStatus('API indisponible en Vite pur. Pour écrire dans le JSON local, lance l’app avec Vercel dev ou déploie avec les secrets GitHub.')
    }
  }

  return (
    <section className="panel add-recipe-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Ajout manuel</p>
          <h3>Ajouter une recette</h3>
        </div>
        <button className="secondary-button" onClick={() => setIsOpen((current) => !current)}>
          {isOpen ? 'Fermer' : 'Nouvelle recette'}
        </button>
      </div>

      {isOpen ? (
        <form className="form-grid recipe-form" onSubmit={submit}>
          <label className="wide">Nom de la recette<input value={form.nom} onChange={(event) => setForm({ ...form, nom: event.target.value })} required /></label>
          <label>Catégorie
            <select value={form.categorie} onChange={(event) => setForm({ ...form, categorie: event.target.value as RecipeFormState['categorie'] })}>
              <option value="petit_dej">Petit-déj</option>
              <option value="repas_principal">Repas principal</option>
              <option value="dessert">Dessert</option>
            </select>
          </label>
          <label>Calories<input type="number" min="1" value={form.calories_kcal} onChange={(event) => setForm({ ...form, calories_kcal: event.target.value })} required /></label>
          <label>Protéines<input type="number" min="0" step="0.1" value={form.proteines_g} onChange={(event) => setForm({ ...form, proteines_g: event.target.value })} required /></label>
          <label>Glucides<input type="number" min="0" step="0.1" value={form.glucides_g} onChange={(event) => setForm({ ...form, glucides_g: event.target.value })} required /></label>
          <label>Lipides<input type="number" min="0" step="0.1" value={form.lipides_g} onChange={(event) => setForm({ ...form, lipides_g: event.target.value })} required /></label>
          <label>Fiabilité
            <select value={form.reliability} onChange={(event) => setForm({ ...form, reliability: event.target.value as RecipeFormState['reliability'] })}>
              <option value="sourced">Sourced</option>
              <option value="partial">Partial</option>
              <option value="estimated">Estimated</option>
            </select>
          </label>
          <label className="wide">Ingrédients, un par ligne<textarea value={form.ingredients} onChange={(event) => setForm({ ...form, ingredients: event.target.value })} required /></label>
          <label className="wide">Instructions, une étape par ligne<textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
          <label className="wide">Note macro optionnelle<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
          <button className="primary-button" type="submit">Ajouter à la database</button>
          {status && <p className="small wide">{status}</p>}
        </form>
      ) : null}
    </section>
  )
}

function RecipeDetail({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const instructions = cleanRecipeLines(recipe.instructions)

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="recipe-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-detail-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fermer le détail de la recette">
          <X size={20} />
        </button>
        <div className="recipe-modal-header">
          <p className="eyebrow">{recipe.macros_source ?? 'source inconnue'}</p>
          <h2 id="recipe-detail-title">{recipe.name}</h2>
          <div className="recipe-macro-grid">
            <MetricMini label="Calories" value={`${recipe.calories} kcal`} />
            <MetricMini label="Protéines" value={`${recipe.macros.protein ?? 0}g`} />
            <MetricMini label="Glucides" value={`${recipe.macros.carbs ?? 0}g`} />
            <MetricMini label="Lipides" value={`${recipe.macros.fat ?? 0}g`} />
          </div>
        </div>

        <div className="recipe-detail-grid">
          <section>
            <h3>Ingrédients</h3>
            <ScaledIngredientList recipe={recipe} factor={1} />
          </section>

          <section>
            <h3>Préparation</h3>
            {instructions.length ? (
              <ol className="detail-list numbered-list">
                {instructions.map((instruction, index) => <li key={`${recipe.id}-instruction-${index}`}>{instruction}</li>)}
              </ol>
            ) : (
              <p className="empty-state">Instructions non renseignées. Cette recette devra être complétée dans le JSON.</p>
            )}
          </section>
        </div>

        {recipe.tags?.length ? (
          <div className="tag-row">
            {recipe.tags.map((tag) => <span className="pill" key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </article>
    </div>
  )
}

function ScaledIngredientList({ recipe, factor }: { recipe: Recipe; factor: number }) {
  const lines = buildScaledLines(recipe.ingredients_structured, cleanRecipeLines(recipe.ingredients), factor)
  if (!lines.length) {
    return <p className="empty-state">Ingrédients non renseignés dans la base.</p>
  }
  const hasUnscaledFallback = factor !== 1 && (!recipe.ingredients_structured || !recipe.ingredients_structured.length)
  return (
    <>
      <ul className="detail-list">
        {lines.map((line, index) => (
          <li key={`${recipe.id}-ing-${index}`}>{line}</li>
        ))}
      </ul>
      {hasUnscaledFallback ? (
        <p className="small muted">Quantités non parsées : multiplier manuellement par x{factor}.</p>
      ) : null}
    </>
  )
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function cleanRecipeLines(lines: string[]) {
  return lines
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
}

function MealPlans() {
  const [previewPlans, setPreviewPlans] = useState<PreviewPlan[]>(() => readPreviewPlansCache())
  const [savedPlans, setSavedPlans] = useState<MealPlan[]>(() => readMealPlansCache())
  const [editor, setEditor] = useState<{ planKey: string; dayDate: string; mealIndex: number } | null>(null)
  const [prepPlanKey, setPrepPlanKey] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({})

  const plans = [
    ...previewPlans.map((preview) => ({ plan: preview.plan, source: 'preview' as const, planKey: preview.id })),
    ...savedPlans.map((plan) => ({ plan, source: 'saved' as const, planKey: `saved-${plan.plan_meta.week}` })),
  ]

  useEffect(() => {
    let cancelled = false
    async function loadSavedPlans() {
      try {
        const response = await fetch('/api/meal-plans')
        const payload = await response.json()
        if (!cancelled && response.ok) {
          setSavedPlans(payload.data as MealPlan[])
        }
      } catch {
        if (!cancelled) setStatus('Plans sauvegardés indisponibles en Vite pur. Lance `npm run dev:api` pour les charger.')
      }
    }
    void loadSavedPlans()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    writePreviewPlansCache(previewPlans)
  }, [previewPlans])

  useEffect(() => {
    writeMealPlansCache(savedPlans)
  }, [savedPlans])

  async function deleteSavedPlan(week: string | number) {
    const weekId = String(week)
    try {
      const response = await fetch('/api/meal-plans', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekId }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setStatus(typeof payload.error === 'string' ? payload.error : 'Suppression impossible.')
        return
      }
      setSavedPlans((current) => current.filter((plan) => String(plan.plan_meta.week) !== weekId))
      setStatus(`Semaine ${weekId} supprimée.`)
    } catch {
      setStatus('Suppression indisponible. Lance `npm run dev:api` pour modifier MEAL_PLANS.json.')
    }
  }

  function addPreviewPlan(plan: MealPlan) {
    const preview: PreviewPlan = { id: makePreviewId(plan), plan }
    setPreviewPlans((current) => [preview, ...current])
    setPendingChanges((current) => ({ ...current, [preview.id]: true }))
  }

  function deletePreviewPlan(planKey: string) {
    setPreviewPlans((current) => current.filter((preview) => preview.id !== planKey))
    setPendingChanges((current) => {
      const next = { ...current }
      delete next[planKey]
      return next
    })
  }

  function updatePlanInState(plan: MealPlan, source: 'preview' | 'saved', planKey: string) {
    if (source === 'preview') {
      setPreviewPlans((current) => current.map((preview) => preview.id === planKey ? { ...preview, plan } : preview))
    } else {
      setSavedPlans((current) => current.map((item) => item.plan_meta.week === plan.plan_meta.week ? plan : item))
    }
    setPendingChanges((current) => ({ ...current, [planKey]: true }))
  }

  function savePlanLocally(plan: MealPlan, planKey: string) {
    setSavedPlans((current) => {
      const exists = current.some((item) => item.plan_meta.week === plan.plan_meta.week)
      return exists
        ? current.map((item) => item.plan_meta.week === plan.plan_meta.week ? plan : item)
        : [plan, ...current]
    })
    if (planKey.startsWith('preview-')) {
      setPreviewPlans((current) => current.filter((preview) => preview.id !== planKey))
      setPendingChanges((current) => {
        const next = { ...current }
        delete next[planKey]
        return next
      })
    } else {
      setPendingChanges((current) => ({ ...current, [planKey]: false }))
    }
  }

  async function persistPlan(plan: MealPlan, planKey: string) {
    setStatus(`Sauvegarde de la semaine ${plan.plan_meta.week}...`)
    try {
      const response = await fetch('/api/meal-plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      })
      const payload = await response.json()
      if (!response.ok) {
        savePlanLocally(plan, planKey)
        setStatus(typeof payload.error === 'string'
          ? `${payload.error} Plan sauvegardé localement dans ce navigateur.`
          : 'Sauvegarde GitHub refusée. Plan sauvegardé localement dans ce navigateur.')
        return
      }
      savePlanLocally(plan, planKey)
      setStatus(`Semaine ${plan.plan_meta.week} sauvegardée dans MEAL_PLANS.json.`)
    } catch {
      savePlanLocally(plan, planKey)
      setStatus('API GitHub indisponible. Plan sauvegardé localement dans ce navigateur.')
    }
  }

  const editorContext = (() => {
    if (!editor) return null
    const planEntry = plans.find((entry) => entry.planKey === editor.planKey)
    if (!planEntry) return null
    const day = planEntry.plan.days.find((d) => d.date === editor.dayDate)
    if (!day) return null
    const meal = day.meals[editor.mealIndex]
    if (!meal) return null
    const targets = computeDayTargetsForPlan(planEntry.plan, day)
    return { plan: planEntry.plan, source: planEntry.source, planKey: planEntry.planKey, day, meal, mealIndex: editor.mealIndex, targets }
  })()

  const prepContext = (() => {
    if (!prepPlanKey) return null
    const planEntry = plans.find((entry) => entry.planKey === prepPlanKey)
    return planEntry ? { plan: planEntry.plan, planKey: planEntry.planKey } : null
  })()

  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Plans disponibles</p>
        <h2>Meal plans</h2>
        <p className="muted">Génère une semaine depuis la database recettes avec tes calories et macros cible.</p>
      </header>
      <MealPlanGenerator onPlanGenerated={addPreviewPlan} avoidRecipeIds={collectMealPlanRecipeIds(plans.map((entry) => entry.plan))} />
      {status && <p className="panel small">{status}</p>}
      {plans.map(({ plan, source, planKey }) => {
        const weekId = String(plan.plan_meta.week)
        const isDirty = pendingChanges[planKey]
        const isPersisted = source === 'saved' || savedPlans.some((savedPlan) => String(savedPlan.plan_meta.week) === weekId)
        return (
          <section className="panel" key={planKey}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Semaine {weekId} · {source === 'saved' ? 'sauvegardée' : 'aperçu'}</p>
                <h3>{plan.plan_meta.date_range}</h3>
              </div>
              <div className="plan-actions">
                <span className="pill">{plan.plan_meta.target_kcal} kcal</span>
                {(source === 'preview' && !isPersisted) || isDirty ? (
                  <button className="primary-button" onClick={() => persistPlan(plan, planKey)}>
                    {source === 'preview' ? 'Sauvegarder ce plan' : 'Sauvegarder modifications'}
                  </button>
                ) : null}
                {isPersisted && !isDirty ? (
                  <button className="secondary-button" onClick={() => setPrepPlanKey(planKey)}>
                    Préparation
                  </button>
                ) : null}
                <button className="danger-button" onClick={() => source === 'preview' ? deletePreviewPlan(planKey) : deleteSavedPlan(plan.plan_meta.week)}>
                  Supprimer
                </button>
              </div>
            </div>
            <div className="days-grid">
              {plan.days.map((day) => (
                <article className="day-card" key={day.date}>
                  <div className="panel-heading">
                    <strong>{day.day_name}</strong>
                    <span className="pill">{day.training?.type ?? 'Rest'}</span>
                  </div>
                  <ul>
                    {day.meals.map((meal, index) => (
                      <li key={`${day.date}-${index}-${meal.recipe_id}`}>
                        <span>{formatMealType(meal.type)}</span>
                        <button
                          className="meal-detail-button"
                          onClick={() => setEditor({ planKey, dayDate: day.date, mealIndex: index })}
                        >
                          {meal.recipe_name}
                        </button>
                        <small>{meal.macros.kcal} kcal{meal.servings !== 1 ? ` · x${meal.servings}` : ''}</small>
                      </li>
                    ))}
                  </ul>
                  <p className="small">Total : {day.daily_totals.kcal} kcal · P {day.daily_totals.protein} · C {day.daily_totals.carbs} · F {day.daily_totals.fat}</p>
                  {day.variance ? (
                    <p className="variance-line">Écart cible : {formatVariance(day.variance.kcal, 'kcal')} · P {formatVariance(day.variance.protein, 'g')} · C {formatVariance(day.variance.carbs, 'g')} · F {formatVariance(day.variance.fat, 'g')}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        )
      })}
      {editorContext && (
        <MealEditor
          context={editorContext}
          onClose={() => setEditor(null)}
          onPlanChange={(plan) => updatePlanInState(plan, editorContext.source, editorContext.planKey)}
        />
      )}
      {prepContext && (
        <MealPrepModal
          plan={prepContext.plan}
          onClose={() => setPrepPlanKey(null)}
        />
      )}
    </div>
  )
}

function MealPrepModal({ plan, onClose }: { plan: MealPlan; onClose: () => void }) {
  const prep = buildMealPrep(plan)
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="recipe-modal prep-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <div className="recipe-modal-header">
          <p className="eyebrow">Préparation semaine</p>
          <h2>{plan.plan_meta.date_range}</h2>
          <div className="recipe-macro-grid">
            <MetricMini label="Jours" value={`${plan.days.length}`} />
            <MetricMini label="Recettes" value={`${prep.recipes.length}`} />
            <MetricMini label="Ingrédients" value={`${prep.shoppingList.length}`} />
            <MetricMini label="À vérifier" value={`${prep.looseIngredients.length}`} />
          </div>
        </div>

        <section className="prep-grid">
          <div>
            <h3>Liste de courses</h3>
            {prep.shoppingList.length ? (
              <ul className="detail-list prep-list">
                {prep.shoppingList.map((item) => (
                  <li key={`${item.unit}-${item.name}`}>
                    <label className="prep-check">
                      <input type="checkbox" />
                      <span><strong>{formatShoppingQuantity(item.quantity, item.unit)}</strong> {item.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Aucun ingrédient quantifié trouvé.</p>
            )}

            {prep.looseIngredients.length ? (
              <div className="prep-subsection">
                <h4>À vérifier dans les recettes</h4>
                <ul className="detail-list prep-list">
                  {prep.looseIngredients.map((item, index) => (
                    <li key={`${item.raw}-${index}`}>
                      <label className="prep-check">
                        <input type="checkbox" />
                        <span>{item.raw}{item.count > 1 ? ` x${item.count}` : ''} <em>({item.recipes.join(', ')})</em></span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div>
            <h3>Dimanche meal prep</h3>
            <ol className="detail-list numbered-list prep-steps">
              {prep.steps.map((step, index) => (
                <li key={`${step}-${index}`}>
                  <label className="prep-check">
                    <input type="checkbox" />
                    <span>{step}</span>
                  </label>
                </li>
              ))}
            </ol>

            <div className="prep-subsection">
              <h4>Portions à préparer</h4>
              <ul className="detail-list prep-list">
                {prep.recipes.map((item) => (
                  <li key={item.recipeId}>
                    <label className="prep-check">
                      <input type="checkbox" />
                      <span><strong>{formatServings(item.servings)} portions</strong> - {item.recipeName} <em>{item.days.join(', ')}</em></span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="prep-recipe-details">
          <h3>Détail des recettes</h3>
          {prep.recipes.map((item) => (
            <article className="prep-recipe-card" key={`${item.recipeId}-detail`}>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{formatServings(item.servings)} portions à manger · recette base {formatServings(item.detail.baseServings)} portions · batch {formatBatchFactor(item.detail.prepFactor)}</p>
                  <h4>{item.recipeName}</h4>
                </div>
              </div>
              <div className="recipe-detail-grid">
                <div>
                  <h5>Ingrédients à préparer</h5>
                  {item.detail.ingredients.length ? (
                    <ul className="detail-list">
                      {item.detail.ingredients.map((line, index) => (
                        <li key={`${item.recipeId}-prep-ing-${index}`}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">Ingrédients non renseignés.</p>
                  )}
                </div>
                <div>
                  <h5>Préparation</h5>
                  {item.detail.instructions.length ? (
                    <ol className="detail-list numbered-list">
                      {item.detail.instructions.map((line, index) => (
                        <li key={`${item.recipeId}-prep-step-${index}`}>{line}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="empty-state">Pas d'instructions renseignées.</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      </article>
    </div>
  )
}

type ShoppingItem = {
  name: string
  unit: string
  quantity: number
}

type LooseIngredient = {
  raw: string
  recipes: string[]
  count: number
}

type PrepRecipeDetail = {
  ingredients: string[]
  instructions: string[]
  baseServings: number
  prepFactor: number
}

type PrepBlock = {
  raw: string
  daySlot: string
}

type PrepRecipe = {
  recipeId: string
  recipeName: string
  servings: number
  days: string[]
  detail: PrepRecipeDetail
}

function buildMealPrep(plan: MealPlan) {
  const shopping = new Map<string, ShoppingItem>()
  const looseIngredients = new Map<string, LooseIngredient>()
  const recipes = new Map<string, PrepRecipe>()
  const blockTasks: PrepBlock[] = []

  plan.days.forEach((day) => {
    day.meals.forEach((meal) => {
      const recipe = initialRecipes.find((item) => item.id === meal.recipe_id)
      const daySlot = `${day.day_name} ${formatMealType(meal.type).toLowerCase()}`

      if (recipe) {
        const current = recipes.get(recipe.id) ?? {
          recipeId: recipe.id,
          recipeName: recipe.name,
          servings: 0,
          days: [],
          detail: {
            ingredients: [],
            instructions: cleanRecipeLines(recipe.instructions),
            baseServings: Math.max(recipe.servings || 1, 1),
            prepFactor: 1,
          },
        }
        current.servings = roundOne(current.servings + meal.servings)
        current.days.push(meal.servings === 1 ? daySlot : `${daySlot} x${meal.servings}`)
        recipes.set(recipe.id, current)
        return
      }

      const block = baseBlocks.find((item) => item.id === meal.recipe_id)
      if (block) {
        addBaseBlockToShopping(block, meal.servings, shopping)
        blockTasks.push({ raw: meal.recipe_name, daySlot })
      }
    })
  })

  const recipeList = [...recipes.values()].sort((a, b) => categoryOrderForRecipe(a.recipeId) - categoryOrderForRecipe(b.recipeId) || a.recipeName.localeCompare(b.recipeName))
  recipeList.forEach((prepRecipe) => {
    const recipe = initialRecipes.find((item) => item.id === prepRecipe.recipeId)
    if (!recipe) return

    const baseServings = Math.max(recipe.servings || 1, 1)
    const prepFactor = prepRecipe.servings / baseServings
    prepRecipe.detail = {
      ingredients: buildPrepIngredientLines(recipe, prepFactor, prepRecipe.servings),
      instructions: cleanRecipeLines(recipe.instructions),
      baseServings,
      prepFactor,
    }
    addRecipeIngredientsToShopping(recipe, prepFactor, shopping, looseIngredients)
  })

  const shoppingList = [...shopping.values()].sort((a, b) => ingredientSortGroup(a) - ingredientSortGroup(b) || a.name.localeCompare(b.name))
  const steps = buildPrepSteps(recipeList, blockTasks)

  return {
    shoppingList,
    looseIngredients: [...looseIngredients.values()].sort((a, b) => a.raw.localeCompare(b.raw)),
    recipes: recipeList,
    steps,
  }
}

function buildPrepIngredientLines(recipe: Recipe, prepFactor: number, servings: number) {
  let replacedHeader = false
  return buildScaledLines(recipe.ingredients_structured, cleanRecipeLines(recipe.ingredients), prepFactor).map((line) => {
    if (!replacedHeader && /^pour\s+\d+/i.test(line.trim())) {
      replacedHeader = true
      return `Pour ${formatServings(servings)} portions à préparer :`
    }
    return line
  })
}

function addRecipeIngredientsToShopping(
  recipe: Recipe,
  factor: number,
  shopping: Map<string, ShoppingItem>,
  looseIngredients: Map<string, LooseIngredient>,
) {
  const lines: IngredientLine[] = recipe.ingredients_structured?.length
    ? recipe.ingredients_structured
    : cleanRecipeLines(recipe.ingredients).map((line) => ({ raw: line, kind: 'item' as const, scalable: false, item: line }))

  lines.forEach((line) => {
    if (line.kind === 'section') return
    if (line.scalable && line.qty !== undefined) {
      addShoppingItem(shopping, line, factor)
      return
    }
    addLooseIngredient(looseIngredients, line.raw, recipe.name)
  })
}

function addShoppingItem(shopping: Map<string, ShoppingItem>, line: IngredientLine, factor: number) {
  const ingredient = normalizeShoppingIngredient(line)
  const normalized = normalizeShoppingQuantity((line.qty ?? 1) * factor, ingredient.unit)
  const name = canonicalIngredientName(ingredient.name)
  if (!name) return
  const key = `${normalized.unit}:${name.toLowerCase()}`
  const current = shopping.get(key) ?? { name, unit: normalized.unit, quantity: 0 }
  current.quantity = roundOne(current.quantity + normalized.quantity)
  shopping.set(key, current)
}

function addBaseBlockToShopping(block: BaseBlock, servings: number, shopping: Map<string, ShoppingItem>) {
  const grams = block.portion_g * servings
  const name = canonicalIngredientName(block.name)
  const key = `g:${name.toLowerCase()}`
  const current = shopping.get(key) ?? { name, unit: 'g', quantity: 0 }
  current.quantity = roundOne(current.quantity + grams)
  shopping.set(key, current)
}

function addLooseIngredient(looseIngredients: Map<string, LooseIngredient>, raw: string, recipeName: string) {
  const normalized = canonicalLooseIngredient(raw)
  if (!normalized) return
  const current = looseIngredients.get(normalized) ?? { raw: normalized, recipes: [], count: 0 }
  current.count += 1
  if (!current.recipes.includes(recipeName)) current.recipes.push(recipeName)
  looseIngredients.set(normalized, current)
}

function normalizeShoppingIngredient(line: IngredientLine) {
  const unit = line.unit?.toLowerCase()
  const countAsIngredient = unit && ['œuf', 'œufs', 'oeuf', 'oeufs', 'tranche', 'tranches', 'tortilla', 'tortillas', 'scoop', 'scoops'].includes(unit) && !line.item
  if (countAsIngredient) {
    return { name: unit, unit: 'unité' }
  }
  return { name: normalizeIngredientName(line.item ?? line.raw), unit: line.unit }
}

function normalizeShoppingQuantity(quantity: number, unit?: string) {
  const normalizedUnit = unit?.toLowerCase() ?? 'unité'
  if (normalizedUnit === 'kg') return { quantity: quantity * 1000, unit: 'g' }
  if (normalizedUnit === 'l') return { quantity: quantity * 1000, unit: 'ml' }
  if (normalizedUnit === 'cl') return { quantity: quantity * 10, unit: 'ml' }
  if (normalizedUnit === 'dl') return { quantity: quantity * 100, unit: 'ml' }
  if (['œuf', 'oeuf'].includes(normalizedUnit)) return { quantity, unit: 'œufs' }
  if (['boite', 'boîte'].includes(normalizedUnit)) return { quantity, unit: 'boîtes' }
  return { quantity, unit: normalizedUnit }
}

function normalizeIngredientName(name: string) {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/^de\s+/i, '')
    .replace(/^d['']/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalIngredientName(name: string) {
  const normalized = normalizeIngredientName(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\b(en cubes|desossee?s?|cuites?|cuits?|crues?|crus|egouttes? et rinces?|chair ferme|bien mures?|mures? ecrasees?|nature|choco|chocolat|vanille)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (/^(whey|proteine en poudre|proteine|protein powder)/.test(normalized)) return 'whey / protéine en poudre'
  if (/^skyr|fromage blanc/.test(normalized) || normalized.includes('skyr ou fromage blanc')) return 'skyr / fromage blanc'
  if (/^yaourt grec/.test(normalized)) return 'yaourt grec'
  if (/^oeufs?$/.test(normalized)) return 'œufs'
  if (/^bananes?$/.test(normalized)) return 'bananes'
  if (/^pommes? de terre/.test(normalized)) return 'pommes de terre'
  if (/^pates? completes?/.test(normalized)) return 'pâtes complètes'
  if (/^pates?$/.test(normalized) || /^macaronis/.test(normalized)) return 'pâtes / macaronis'
  if (/^farine d avoine/.test(normalized)) return "farine d'avoine"
  if (/^flocons? d avoine/.test(normalized)) return "flocons d'avoine"
  if (/^parmesan/.test(normalized)) return 'parmesan râpé'
  if (/^pomme$/.test(normalized)) return 'pomme'
  if (/^oignons? rouges?$/.test(normalized)) return 'oignon rouge'
  if (/^oignons?$/.test(normalized)) return 'oignon'
  if (/^ail$/.test(normalized)) return 'ail'
  if (/^ail en poudre/.test(normalized)) return 'ail en poudre'
  return normalized
}

function canonicalLooseIngredient(raw: string) {
  const normalized = normalizeIngredientName(raw)
    .replace(/^optionnel\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  const lower = normalized.toLowerCase()
  if (lower === 'sel, poivre' || lower === 'sel et poivre') return 'sel, poivre'
  if (lower.includes('paprika')) return 'paprika'
  if (lower.includes('ail en poudre')) return 'ail en poudre'
  if (lower.includes('origan')) return 'origan'
  if (lower.includes('salade')) return 'salade'
  if (lower.includes('persil')) return 'persil frais'
  if (lower.includes('fruits rouges')) return 'fruits rouges'
  return normalized
}

function buildPrepSteps(recipes: PrepRecipe[], blockTasks: PrepBlock[]) {
  const steps = [
    'Sortir les boîtes repas, étiqueter les jours, et préchauffer le four si plusieurs recettes passent au four.',
    'Lancer en premier les cuissons longues : féculents, patates, riz, pâtes, légumes rôtis et protéines au four.',
  ]

  recipes.forEach((recipe) => {
    const prefix = categoryOrderForRecipe(recipe.recipeId) <= 1 ? 'Préparer en batch' : 'Préparer ou portionner'
    steps.push(`${prefix} ${formatServings(recipe.servings)} portions de ${recipe.recipeName} (${formatBatchFactor(recipe.detail.prepFactor)} recette base) pour ${recipe.days.join(', ')}.`)
  })

  if (blockTasks.length) {
    steps.push(`Portionner les ajustements/goûters séparément : ${blockTasks.map((task) => `${task.raw} pour ${task.daySlot}`).join('; ')}.`)
  }

  steps.push('Laisser refroidir les plats chauds, fermer les boîtes, puis stocker 3 jours au frigo et congeler le surplus.')
  return steps
}

function categoryOrderForRecipe(recipeId: string) {
  const recipe = initialRecipes.find((item) => item.id === recipeId)
  if (recipe?.category === 'petit_dej') return 0
  if (recipe?.category === 'repas_principal') return 1
  if (recipe?.category === 'dessert') return 2
  return 3
}

function ingredientSortGroup(item: ShoppingItem) {
  const name = item.name.toLowerCase()
  if (/poulet|dinde|bœuf|boeuf|steak|thon|saumon|cabillaud|crevette|œuf|oeuf|whey|skyr|yaourt|cottage/.test(name)) return 0
  if (/riz|pâte|pate|patate|pomme de terre|avoine|pain|tortilla|flocon|cereal|céréale/.test(name)) return 1
  if (/brocoli|haricot|épinard|epinard|courgette|salade|tomate|oignon|concombre|légume|legume/.test(name)) return 2
  if (/pomme|banane|fruit|fraise|myrtille|framboise|avocat/.test(name)) return 3
  if (/huile|amande|beurre|cacahuète|cacahuete|tahini|fromage/.test(name)) return 4
  return 5
}

function formatShoppingQuantity(quantity: number, unit: string) {
  const rounded = roundOne(quantity)
  const displayQuantity = Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : String(rounded)
  return unit === 'unité' ? displayQuantity : `${displayQuantity} ${unit}`
}

function formatServings(servings: number) {
  return Math.abs(servings - Math.round(servings)) < 0.05 ? String(Math.round(servings)) : String(roundOne(servings))
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10
}

function formatBatchFactor(factor: number) {
  if (Math.abs(factor - 1) < 0.05) return '1x'
  return `${formatServings(factor)}x`
}

type EditorContext = {
  plan: MealPlan
  source: 'preview' | 'saved'
  planKey: string
  day: MealPlan['days'][number]
  meal: MealPlan['days'][number]['meals'][number]
  mealIndex: number
  targets: { kcal: number; protein: number; carbs: number; fat: number }
}

function MealEditor({ context, onClose, onPlanChange }: { context: EditorContext; onClose: () => void; onPlanChange: (plan: MealPlan) => void }) {
  const { plan, day, meal, mealIndex, targets } = context
  const recipe = initialRecipes.find((item) => item.id === meal.recipe_id) ?? null
  const category = recipe?.category ?? slotCategoryFromMeal(meal.type)
  const alternatives = initialRecipes
    .filter((item) => item.category === category && item.id !== meal.recipe_id)
    .sort((a, b) => Math.abs(a.calories - meal.macros.kcal / meal.servings) - Math.abs(b.calories - meal.macros.kcal / meal.servings))
    .slice(0, 30)
  const isAdjustment = ['glucide', 'glucide-extra', 'lipide', 'whey', 'proteine', 'ajustement'].includes(meal.type)

  function updatePlanWithMeals(meals: MealPlan['days'][number]['meals']) {
    const dailyTotals = sumMealMacrosClient(meals)
    const variance = {
      kcal: dailyTotals.kcal - targets.kcal,
      protein: dailyTotals.protein - targets.protein,
      carbs: dailyTotals.carbs - targets.carbs,
      fat: dailyTotals.fat - targets.fat,
    }
    const nextDay = { ...day, meals, daily_totals: dailyTotals, variance }
    const nextPlan: MealPlan = {
      ...plan,
      days: plan.days.map((item) => item.date === day.date ? nextDay : item),
    }
    onPlanChange(nextPlan)
  }

  function changeServings(delta: number) {
    if (!recipe) return
    const nextServings = Math.max(0.5, Math.round((meal.servings + delta) * 2) / 2)
    if (nextServings === meal.servings) return
    const nextMeal = scaleMealToServings(meal, recipe, nextServings)
    const nextMeals = day.meals.map((item, index) => index === mealIndex ? nextMeal : item)
    updatePlanWithMeals(nextMeals)
  }

  function replaceWith(nextRecipe: Recipe) {
    const nextMeal = scaleMealToServings(
      { ...meal, recipe_id: nextRecipe.id, recipe_name: nextRecipe.name, servings: 1 },
      nextRecipe,
      1,
    )
    const nextMeals = day.meals.map((item, index) => index === mealIndex ? nextMeal : item)
    updatePlanWithMeals(nextMeals)
  }

  function removeMeal() {
    const nextMeals = day.meals.filter((_, index) => index !== mealIndex)
    updatePlanWithMeals(nextMeals)
    onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article className="recipe-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <div className="recipe-modal-header">
          <p className="eyebrow">{day.day_name} · {formatMealType(meal.type)}</p>
          <h2>{meal.recipe_name}</h2>
          <div className="recipe-macro-grid">
            <MetricMini label="Calories" value={`${meal.macros.kcal} kcal`} />
            <MetricMini label="Protéines" value={`${meal.macros.protein}g`} />
            <MetricMini label="Glucides" value={`${meal.macros.carbs}g`} />
            <MetricMini label="Lipides" value={`${meal.macros.fat}g`} />
          </div>
        </div>

        {!isAdjustment && recipe ? (
          <section className="meal-editor-controls">
            <div className="portion-row">
              <span className="eyebrow">Portion</span>
              <button className="secondary-button" onClick={() => changeServings(-0.5)} disabled={meal.servings <= 0.5}>-0.5</button>
              <strong>x{meal.servings}</strong>
              <button className="secondary-button" onClick={() => changeServings(0.5)}>+0.5</button>
            </div>
            <button className="danger-button" onClick={removeMeal}>Retirer ce repas</button>
          </section>
        ) : (
          <section className="meal-editor-controls">
            <p className="small muted">Ajustement automatique (bloc de base). Tu peux le retirer ou changer la recette.</p>
            <button className="danger-button" onClick={removeMeal}>Retirer cet ajustement</button>
          </section>
        )}

        {recipe ? (
          <section className="recipe-detail-grid">
            <div>
              <h3>Ingrédients{meal.servings !== 1 ? ` (x${meal.servings})` : ''}</h3>
              <ScaledIngredientList recipe={recipe} factor={meal.servings} />
            </div>
            <div>
              <h3>Préparation</h3>
              {recipe.instructions.length ? (
                <ol className="detail-list numbered-list">
                  {cleanRecipeLines(recipe.instructions).map((line, index) => (
                    <li key={`${recipe.id}-inst-${index}`}>{line}</li>
                  ))}
                </ol>
              ) : (
                <p className="empty-state">Pas d'instructions renseignées.</p>
              )}
            </div>
          </section>
        ) : (
          <p className="empty-state">Détails recette non disponibles (bloc de base ou recette supprimée).</p>
        )}

        {category ? (
          <section className="alternative-list">
            <h3>Remplacer par</h3>
            <p className="small muted">Recettes de la catégorie {formatCategoryLabel(category)}, triées par proximité kcal.</p>
            <ul className="alternative-grid">
              {alternatives.map((item) => (
                <li key={item.id}>
                  <button className="alternative-card" onClick={() => replaceWith(item)}>
                    <strong>{item.name}</strong>
                    <span className="small muted">{item.calories} kcal · P {item.macros.protein ?? 0} · C {item.macros.carbs ?? 0} · F {item.macros.fat ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  )
}

function slotCategoryFromMeal(type: string): 'petit_dej' | 'repas_principal' | 'dessert' | null {
  if (type === 'petit_dej') return 'petit_dej'
  if (type === 'repas_1' || type === 'repas_2') return 'repas_principal'
  if (type === 'dessert' || type === 'collation') return 'dessert'
  return null
}

function scaleMealToServings(
  meal: MealPlan['days'][number]['meals'][number],
  recipe: Recipe,
  servings: number,
): MealPlan['days'][number]['meals'][number] {
  return {
    ...meal,
    recipe_id: recipe.id,
    recipe_name: servings === 1 ? recipe.name : `${recipe.name} (x${servings})`,
    servings,
    macros: {
      kcal: Math.round(recipe.calories * servings),
      protein: Math.round((recipe.macros.protein ?? 0) * servings * 10) / 10,
      carbs: Math.round((recipe.macros.carbs ?? 0) * servings * 10) / 10,
      fat: Math.round((recipe.macros.fat ?? 0) * servings * 10) / 10,
    },
  }
}

function sumMealMacrosClient(meals: MealPlan['days'][number]['meals']) {
  return meals.reduce(
    (acc, meal) => ({
      kcal: acc.kcal + meal.macros.kcal,
      protein: Math.round((acc.protein + meal.macros.protein) * 10) / 10,
      carbs: Math.round((acc.carbs + meal.macros.carbs) * 10) / 10,
      fat: Math.round((acc.fat + meal.macros.fat) * 10) / 10,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
}

function computeDayTargetsForPlan(plan: MealPlan, day: MealPlan['days'][number]) {
  const variance = day.variance
  const totals = day.daily_totals
  if (variance) {
    return {
      kcal: totals.kcal - variance.kcal,
      protein: Math.round((totals.protein - variance.protein) * 10) / 10,
      carbs: Math.round((totals.carbs - variance.carbs) * 10) / 10,
      fat: Math.round((totals.fat - variance.fat) * 10) / 10,
    }
  }
  return {
    kcal: plan.plan_meta.target_kcal,
    protein: plan.plan_meta.target_macros.protein,
    carbs: plan.plan_meta.target_macros.carbs,
    fat: plan.plan_meta.target_macros.fat,
  }
}

function formatCategoryLabel(category: string) {
  if (category === 'petit_dej') return 'petit-déj'
  if (category === 'repas_principal') return 'repas principal'
  return category
}

type ReliabilityKey = 'sourced' | 'partial' | 'estimated'

type MealPlanFormState = {
  profile: 'noah' | 'other'
  week_start: string
  target_kcal: string
  protein: string
  carbs: string
  fat: string
  variety: 'low' | 'high'
  carb_cycling: boolean
  carb_cycling_delta: string
  reliability: Record<ReliabilityKey, boolean>
}

function MealPlanGenerator({ onPlanGenerated, avoidRecipeIds }: { onPlanGenerated: (plan: MealPlan) => void; avoidRecipeIds: string[] }) {
  const nextMonday = getNextMondayIso()
  const noahDefaults = getNoahTargetsForDate(nextMonday)
  const [form, setForm] = useState<MealPlanFormState>({
    profile: 'noah',
    week_start: nextMonday,
    target_kcal: String(noahDefaults.target_kcal),
    protein: String(noahDefaults.macros.protein),
    carbs: String(noahDefaults.macros.carbs),
    fat: String(noahDefaults.macros.fat),
    variety: 'high',
    carb_cycling: true,
    carb_cycling_delta: '30',
    reliability: { sourced: true, partial: true, estimated: false },
  })
  const [status, setStatus] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<string | null>(null)

  const activeReliability = (Object.keys(form.reliability) as ReliabilityKey[]).filter((key) => form.reliability[key])
  const usableRecipes = initialRecipes.filter((recipe) => {
    if (!activeReliability.length) return true
    const r = (recipe.reliability ?? recipe.macros_source ?? 'estimated') as ReliabilityKey
    return activeReliability.includes(r)
  }).length

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targets = {
      kcal: Number(form.target_kcal),
      protein: Number(form.protein),
      carbs: Number(form.carbs),
      fat: Number(form.fat),
    }

    const options: MealPlanOptions = {
      weekStart: form.week_start,
      targetKcal: targets.kcal,
      targetMacros: { protein: targets.protein, carbs: targets.carbs, fat: targets.fat },
      variety: form.variety,
      carbCycling: form.profile === 'noah' && form.carb_cycling,
      carbCyclingDelta: Number(form.carb_cycling_delta) || 0,
      reliabilityFilter: activeReliability,
      trainingSchedule: form.profile === 'noah' ? reverseConfig.training_schedule : {},
      avoidRecipeIds,
    }

    let plan: MealPlan
    try {
      plan = generateMealPlan(options, initialRecipes, baseBlocks)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue'
      setStatus(`Échec : ${message}`)
      setDiagnostic(null)
      return
    }

    onPlanGenerated(plan)
    setDiagnostic(buildDiagnostic(plan, targets))
    setStatus('Planning ajouté en aperçu. Garde-le, ajuste-le ou supprime-le. Clique sur "Sauvegarder ce plan" seulement quand il est bon.')
  }

  function toggleReliability(key: ReliabilityKey) {
    setForm({ ...form, reliability: { ...form.reliability, [key]: !form.reliability[key] } })
  }

  function changeProfile(profile: MealPlanFormState['profile']) {
    if (profile === 'noah') {
      const defaults = getNoahTargetsForDate(form.week_start)
      setForm({
        ...form,
        profile,
        target_kcal: String(defaults.target_kcal),
        protein: String(defaults.macros.protein),
        carbs: String(defaults.macros.carbs),
        fat: String(defaults.macros.fat),
        carb_cycling: true,
        carb_cycling_delta: form.carb_cycling_delta || '30',
      })
      return
    }

    setForm({ ...form, profile, carb_cycling: false, carb_cycling_delta: '0' })
  }

  function changeWeekStart(weekStart: string) {
    if (form.profile !== 'noah') {
      setForm({ ...form, week_start: weekStart })
      return
    }

    const defaults = getNoahTargetsForDate(weekStart)
    setForm({
      ...form,
      week_start: weekStart,
      target_kcal: String(defaults.target_kcal),
      protein: String(defaults.macros.protein),
      carbs: String(defaults.macros.carbs),
      fat: String(defaults.macros.fat),
    })
  }

  return (
    <section className="panel generator-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Générateur optimisé</p>
          <h3>Créer une semaine cible</h3>
          <p className="small">Recherche globale semaine + correction par blocs. Hit kcal et macros à ±5%.</p>
        </div>
        <span className="pill">{usableRecipes} recettes utilisables · {avoidRecipeIds.length} déjà vues pénalisées</span>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>Profil
          <div className="range-tabs" role="group">
            <button type="button" className={form.profile === 'noah' ? 'active' : ''} onClick={() => changeProfile('noah')}>Noah</button>
            <button type="button" className={form.profile === 'other' ? 'active' : ''} onClick={() => changeProfile('other')}>Autre</button>
          </div>
        </label>
        <label>Début de semaine<input type="date" value={form.week_start} onChange={(event) => changeWeekStart(event.target.value)} required /></label>
        <label>Kcal / jour<input type="number" min="800" value={form.target_kcal} onChange={(event) => setForm({ ...form, target_kcal: event.target.value })} required /></label>
        <label>Protéines (g)<input type="number" min="0" value={form.protein} onChange={(event) => setForm({ ...form, protein: event.target.value })} required /></label>
        <label>Glucides (g, 0 = libre)<input type="number" min="0" value={form.carbs} onChange={(event) => setForm({ ...form, carbs: event.target.value })} required /></label>
        <label>Lipides (g, 0 = libre)<input type="number" min="0" value={form.fat} onChange={(event) => setForm({ ...form, fat: event.target.value })} required /></label>

        <label>Variété
          <div className="range-tabs" role="group">
            <button type="button" className={form.variety === 'low' ? 'active' : ''} onClick={() => setForm({ ...form, variety: 'low' })}>Low (batch prep)</button>
            <button type="button" className={form.variety === 'high' ? 'active' : ''} onClick={() => setForm({ ...form, variety: 'high' })}>High (varié)</button>
          </div>
        </label>

        <label>Carb cycling
          <div className="range-tabs" role="group">
            <button type="button" className={form.carb_cycling ? 'active' : ''} onClick={() => setForm({ ...form, carb_cycling: true })} disabled={form.profile !== 'noah'}>ON</button>
            <button type="button" className={!form.carb_cycling ? 'active' : ''} onClick={() => setForm({ ...form, carb_cycling: false })}>OFF</button>
          </div>
        </label>

        <label>Delta cycling (g glucides)
          <input
            type="number"
            min="0"
            max="100"
            value={form.carb_cycling_delta}
            onChange={(event) => setForm({ ...form, carb_cycling_delta: event.target.value })}
            disabled={form.profile !== 'noah' || !form.carb_cycling}
          />
        </label>

        <fieldset className="wide reliability-row">
          <legend>Fiabilité des recettes</legend>
          {(['sourced', 'partial', 'estimated'] as ReliabilityKey[]).map((key) => (
            <label key={key} className="checkbox-pill">
              <input type="checkbox" checked={form.reliability[key]} onChange={() => toggleReliability(key)} />
              <span>{key}</span>
            </label>
          ))}
        </fieldset>

        <button className="primary-button wide" type="submit">Générer la semaine</button>
        {status && <p className="small wide">{status}</p>}
        {diagnostic && <pre className="small wide diagnostic-block">{diagnostic}</pre>}
      </form>
    </section>
  )
}

function buildDiagnostic(plan: MealPlan, targets: { kcal: number; protein: number; carbs: number; fat: number }) {
  const verdict = buildPlanVerdict(plan)
  const lines = plan.days.map((day) => {
    const totals = day.daily_totals
    const dKcal = Math.round(day.variance?.kcal ?? totals.kcal - targets.kcal)
    const dP = Math.round((day.variance?.protein ?? totals.protein - targets.protein) * 10) / 10
    const dC = Math.round((day.variance?.carbs ?? totals.carbs - targets.carbs) * 10) / 10
    const dF = Math.round((day.variance?.fat ?? totals.fat - targets.fat) * 10) / 10
    return `${day.day_name.padEnd(9)} ${Math.round(totals.kcal)} kcal (${formatSign(dKcal)}) | P ${totals.protein}g (${formatSign(dP)}) | C ${totals.carbs}g (${formatSign(dC)}) | F ${totals.fat}g (${formatSign(dF)})`
  })
  return [
    `${verdict.label} · ${verdict.summary}`,
    `Écart moyen : ${verdict.avgKcal} kcal | P ${verdict.avgProtein}g | C ${verdict.avgCarbs}g | F ${verdict.avgFat}g`,
    `Action : ${verdict.action}`,
    '',
    ...lines,
  ].join('\n')
}

function buildPlanVerdict(plan: MealPlan) {
  const count = Math.max(plan.days.length, 1)
  const totals = plan.days.reduce(
    (acc, day) => {
      const variance = day.variance ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }
      return {
        kcal: acc.kcal + Math.abs(variance.kcal),
        protein: acc.protein + Math.abs(variance.protein),
        carbs: acc.carbs + Math.abs(variance.carbs),
        fat: acc.fat + Math.abs(variance.fat),
      }
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

  const avg = {
    kcal: Math.round(totals.kcal / count),
    protein: Math.round((totals.protein / count) * 10) / 10,
    carbs: Math.round((totals.carbs / count) * 10) / 10,
    fat: Math.round((totals.fat / count) * 10) / 10,
  }

  if (avg.kcal <= 50 && avg.protein <= 5 && avg.carbs <= 8 && avg.fat <= 5) {
    return {
      label: 'Plan très précis',
      summary: 'tu peux le suivre sans relancer.',
      action: 'valide ce planning et passe à la préparation.',
      avgKcal: avg.kcal,
      avgProtein: avg.protein,
      avgCarbs: avg.carbs,
      avgFat: avg.fat,
    }
  }

  if (avg.kcal <= 160 && avg.protein <= 12 && avg.carbs <= 25 && avg.fat <= 10) {
    return {
      label: 'Plan OK meal prep',
      summary: 'acceptable si tu privilégies la simplicité.',
      action: 'garde-le en low variety, ou relance une fois si tu veux mieux.',
      avgKcal: avg.kcal,
      avgProtein: avg.protein,
      avgCarbs: avg.carbs,
      avgFat: avg.fat,
    }
  }

  return {
    label: 'Plan trop éloigné',
    summary: 'les écarts sont trop hauts pour suivre ça proprement.',
    action: 'relance, passe en high variety, désactive le carb cycling ou élargis les fiabilités.',
    avgKcal: avg.kcal,
    avgProtein: avg.protein,
    avgCarbs: avg.carbs,
    avgFat: avg.fat,
  }
}

function formatSign(value: number) {
  if (value === 0) return '±0'
  return value > 0 ? `+${value}` : `${value}`
}

function getNextMondayIso() {
  const date = new Date()
  const day = date.getDay()
  const offset = day === 0 ? 1 : 8 - day
  date.setDate(date.getDate() + offset)
  return toIsoDate(date)
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getNoahTargetsForDate(isoDate: string) {
  const phases = Object.values(reverseConfig.phases)
  const matchingPhase = phases.find((phase) => {
    const [start, end] = phase.dates.split(' to ')
    return isoDate >= start && isoDate <= end
  })
  return matchingPhase ?? phases[0]
}

function formatVariance(value: number, unit: string) {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}${unit}`
}

function formatMealType(type: string) {
  const labels: Record<string, string> = {
    petit_dej: 'Petit-déjeuner',
    repas_1: 'Déjeuner',
    repas_2: 'Dîner',
    dessert: 'Dessert',
    collation: 'Goûter',
    glucide: 'Ajustement glucides',
    'glucide-extra': 'Ajustement glucides',
    proteine: 'Ajustement protéines',
    lipide: 'Ajustement lipides',
  }
  return labels[type] ?? type.replace(/_/g, ' ')
}

type PreviewPlan = {
  id: string
  plan: MealPlan
}

const PAGE_CACHE_KEY = 'health-tracker.current-page'
const PREVIEW_PLANS_CACHE_KEY = 'health-tracker.preview-plans'
const SAVED_PLANS_CACHE_KEY = 'health-tracker.saved-plans'

function readPageCache(): Page {
  if (typeof window === 'undefined') return 'dashboard'
  const raw = window.localStorage.getItem(PAGE_CACHE_KEY)
  return navItems.some((item) => item.id === raw) ? raw as Page : 'dashboard'
}

function writePageCache(page: Page) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PAGE_CACHE_KEY, page)
}

function readPreviewPlansCache() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(PREVIEW_PLANS_CACHE_KEY)
    return raw ? JSON.parse(raw) as PreviewPlan[] : []
  } catch {
    return []
  }
}

function writePreviewPlansCache(plans: PreviewPlan[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PREVIEW_PLANS_CACHE_KEY, JSON.stringify(plans))
}

function makePreviewId(plan: MealPlan) {
  return `preview-${plan.plan_meta.week}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function collectMealPlanRecipeIds(plans: MealPlan[]) {
  const ids = new Set<string>()
  plans.forEach((plan) => {
    plan.days.forEach((day) => {
      day.meals.forEach((meal) => {
        if (!meal.recipe_id.startsWith('bloc_')) ids.add(meal.recipe_id)
      })
    })
  })
  return [...ids]
}

function readMealPlansCache() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SAVED_PLANS_CACHE_KEY)
    return raw ? JSON.parse(raw) as MealPlan[] : []
  } catch {
    return []
  }
}

function writeMealPlansCache(plans: MealPlan[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SAVED_PLANS_CACHE_KEY, JSON.stringify(plans))
}

function DailyLog({ entries, onEntriesChange }: { entries: TrackingEntry[]; onEntriesChange: (entries: TrackingEntry[]) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ date: today, weight_kg: '', calories_estimated: '', protein: '', carbs: '', fat: '', training_type: 'Rest', duration_minutes: '', notes: '' })
  const [status, setStatus] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entry: TrackingEntry = {
      date: form.date,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined,
      weight_time: form.weight_kg ? '08:30' : undefined,
      calories_estimated: form.calories_estimated ? Number(form.calories_estimated) : undefined,
      macros_actual: {
        protein: form.protein ? Number(form.protein) : null,
        carbs: form.carbs ? Number(form.carbs) : null,
        fat: form.fat ? Number(form.fat) : null,
      },
      training: {
        type: form.training_type,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : 0,
        intensity: 'moderate',
      },
      notes: form.notes || undefined,
    }
    const next = [...entries.filter((item) => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date))
    onEntriesChange(next)
    setStatus('Entrée ajoutée localement. Tentative de sync GitHub...')

    try {
      const response = await fetch('/api/tracking/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
      const payload = await response.json()
      setStatus(response.ok ? 'Sync GitHub réussie.' : payload.error ?? 'Sync GitHub non configurée.')
    } catch {
      setStatus('Mode local : API indisponible pendant le dev Vite.')
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Accountability</p>
        <h2>Log quotidien</h2>
        <p className="muted">Objectif : moins de 5 minutes par jour, pas de friction.</p>
      </header>
      <form className="panel form-grid" onSubmit={submit}>
        <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
        <label>Poids<input type="number" step="0.1" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: event.target.value })} /></label>
        <label>Calories<input type="number" value={form.calories_estimated} onChange={(event) => setForm({ ...form, calories_estimated: event.target.value })} /></label>
        <label>Protéines<input type="number" value={form.protein} onChange={(event) => setForm({ ...form, protein: event.target.value })} /></label>
        <label>Glucides<input type="number" value={form.carbs} onChange={(event) => setForm({ ...form, carbs: event.target.value })} /></label>
        <label>Lipides<input type="number" value={form.fat} onChange={(event) => setForm({ ...form, fat: event.target.value })} /></label>
        <label>Training<input value={form.training_type} onChange={(event) => setForm({ ...form, training_type: event.target.value })} /></label>
        <label>Durée<input type="number" value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} /></label>
        <label className="wide">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <button className="primary-button" type="submit">Log day</button>
        {status && <p className="small wide">{status}</p>}
      </form>
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="stack">
      <header className="page-header">
        <p className="eyebrow">Configuration</p>
        <h2>Reverse diet</h2>
        <p className="muted">Les valeurs ci-dessous viennent de CONFIG_REVERSE_DIET.json.</p>
      </header>
      <section className="grid cards-3">
        {Object.entries(reverseConfig.phases).map(([key, phase]) => (
          <article className="panel" key={key}>
            <p className="eyebrow">{key.replaceAll('_', ' ')}</p>
            <h3>{phase.target_kcal} kcal</h3>
            <p className="muted">{phase.dates}</p>
            <p className="small">P {phase.macros.protein} · C {phase.macros.carbs} · F {phase.macros.fat}</p>
          </article>
        ))}
      </section>
      <section className="panel">
        <h3>Planning entraînement</h3>
        <div className="table-list">
          {Object.entries(reverseConfig.training_schedule).map(([day, training]) => (
            <div className="table-row" key={day}>
              <span>{day}</span>
              <strong>{training.type} · {training.duration_minutes ?? 0} min</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, helper }: { icon: typeof Weight; label: string; value: string; helper: string }) {
  return (
    <article className="metric-card">
      <Icon size={20} />
      <p className="muted">{label}</p>
      <strong>{value}</strong>
      <span className="small">{helper}</span>
    </article>
  )
}

function MacroBar({ label, value, target }: { label: string; value: number | null | undefined; target: number }) {
  const completion = macroCompletion(value, target)
  return (
    <article className="panel compact-panel">
      <div className="panel-heading">
        <h3>{label}</h3>
        <span>{value ?? 0} / {target}g</span>
      </div>
      <div className="bar"><span style={{ width: `${Math.min(100, completion)}%` }} /></div>
    </article>
  )
}

function toChartData(entries: TrackingEntry[]) {
  return {
    labels: entries.map((entry) => entry.date.slice(5)),
    datasets: [
      { label: 'Poids kg', data: entries.map((entry) => entry.weight_kg ?? null), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.3, spanGaps: true, yAxisID: 'y' },
      { label: 'Calories', data: entries.map((entry) => entry.calories_estimated ?? null), borderColor: '#f97316', backgroundColor: '#f97316', tension: 0.3, spanGaps: true, yAxisID: 'y1' },
    ],
  }
}

function chartRangeLabel(range: '30d' | '3m' | '1y' | 'all') {
  if (range === '30d') return '30 derniers jours'
  if (range === '3m') return '3 derniers mois'
  if (range === '1y') return '1 an'
  return 'Historique complet'
}

function chartRangeButtonLabel(range: '30d' | '3m' | '1y' | 'all') {
  if (range === '30d') return '30j'
  if (range === '3m') return '3m'
  if (range === '1y') return '1 an'
  return 'Tout'
}

const chartOptions = {
  responsive: true,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: { legend: { position: 'bottom' as const } },
  scales: {
    y: { type: 'linear' as const, position: 'left' as const },
    y1: { type: 'linear' as const, position: 'right' as const, grid: { drawOnChartArea: false } },
  },
}

export default App
