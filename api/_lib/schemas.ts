import { z } from 'zod'

export const trackingEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight_kg: z.number().positive().optional(),
  weight_time: z.string().optional(),
  calories_estimated: z.number().int().positive().optional(),
  macros_actual: z.object({ protein: z.number().nullable().optional(), carbs: z.number().nullable().optional(), fat: z.number().nullable().optional() }).optional(),
  training: z.object({ type: z.string(), duration_minutes: z.number().optional(), duration: z.number().optional(), intensity: z.string().optional() }).optional(),
  notes: z.string().optional(),
})

export const mealPlanGenerateSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_kcal: z.number().int().positive(),
  target_macros: z.object({ protein: z.number(), carbs: z.number(), fat: z.number() }),
  training_schedule: z.record(z.string(), z.unknown()).optional(),
  preferences: z.object({
    no_repetition_days: z.number().int().min(0).optional(),
    variety: z.enum(['low', 'high']).optional(),
    carb_cycling: z.boolean().optional(),
    carb_cycling_delta: z.number().min(0).optional(),
    reliability: z.array(z.enum(['sourced', 'partial', 'estimated'])).optional(),
  }).optional(),
})

export const recipeCreateSchema = z.object({
  nom: z.string().min(2),
  categorie: z.enum(['petit_dej', 'repas_principal', 'dessert']).default('repas_principal'),
  ingredients: z.string().min(2),
  instructions: z.string().nullable().optional(),
  calories_kcal: z.number().positive(),
  proteines_g: z.number().min(0),
  glucides_g: z.number().min(0),
  lipides_g: z.number().min(0),
  reliability: z.enum(['sourced', 'partial', 'estimated']).default('estimated'),
  note: z.string().nullable().optional(),
})
