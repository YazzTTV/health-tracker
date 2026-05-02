export type MealType = "breakfast" | "lunch" | "dinner" | "snack" | string

export type MacroTargets = {
  protein: number | null
  carbs: number | null
  fat: number | null
}

export type IngredientLine = {
  raw: string
  kind: "section" | "item"
  scalable: boolean
  qty?: number
  unit?: string
  item?: string
}

export type Recipe = {
  id: string
  name: string
  calories: number
  macros: MacroTargets
  ingredients: string[]
  ingredients_structured?: IngredientLine[]
  instructions: string[]
  servings: number
  macros_source?: string
  reliability?: "sourced" | "partial" | "estimated" | string
  note?: string | null
  meal_type?: MealType
  category?: "petit_dej" | "repas_principal" | "dessert" | string
  tags?: string[]
}

export type BaseBlock = {
  id: string
  name: string
  type: "glucide" | "proteine" | "lipide" | "legume" | "fruit" | string
  portion_g: number
  macros: {
    kcal: number
    protein: number
    carbs: number
    fat: number
  }
}

export type TrainingEntry = {
  type: string
  duration_minutes?: number
  duration?: number
  intensity?: "low" | "moderate" | "high" | string
  time?: string
  carbs_target?: number
}

export type TrackingEntry = {
  date: string
  weight_kg?: number
  weight_time?: string
  calories_estimated?: number
  macros_actual?: MacroTargets
  training?: TrainingEntry
  notes?: string
}

export type TrackingLog = {
  tracking: TrackingEntry[]
}

export type MealPlanMeal = {
  type: MealType
  recipe_id: string
  recipe_name: string
  servings: number
  macros: { kcal: number; protein: number; carbs: number; fat: number }
}

export type MealPlanDay = {
  date: string
  day_name: string
  training?: TrainingEntry
  meals: MealPlanMeal[]
  daily_totals: { kcal: number; protein: number; carbs: number; fat: number }
  note?: string
  variance?: Record<string, number>
}

export type MealPlan = {
  plan_meta: {
    week: number | string
    date_range: string
    phase: string
    target_kcal: number
    target_macros: { protein: number; carbs: number; fat: number }
    note?: string
  }
  days: MealPlanDay[]
}

export type ReverseConfig = {
  profile: Record<string, unknown>
  phases: Record<string, {
    dates: string
    target_kcal: number
    macros: { protein: number; carbs: number; fat: number }
  }>
  training_schedule: Record<string, TrainingEntry & { carbs_multiplier?: number }>
  preferences: Record<string, unknown>
}
