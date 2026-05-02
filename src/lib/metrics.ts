import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns'
import type { TrackingEntry } from '../types/health'

export function byDate(entries: TrackingEntry[]) {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

export function latestEntry(entries: TrackingEntry[]) {
  return byDate(entries).at(-1)
}

export function entriesWithWeight(entries: TrackingEntry[]) {
  return byDate(entries).filter((entry) => typeof entry.weight_kg === 'number')
}

export function sevenDayAverage(entries: TrackingEntry[]) {
  const weighted = entriesWithWeight(entries).slice(-7)
  if (!weighted.length) return null
  const sum = weighted.reduce((total, entry) => total + (entry.weight_kg ?? 0), 0)
  return Number((sum / weighted.length).toFixed(1))
}

export function rangeEntries(entries: TrackingEntry[], days: number) {
  const last = latestEntry(entries)
  const end = last?.date ? parseISO(last.date) : new Date()
  const start = subDays(end, days)
  return byDate(entries).filter((entry) => differenceInCalendarDays(parseISO(entry.date), start) >= 0)
}

export function weeklyWeightAverages(entries: TrackingEntry[]) {
  const buckets = new Map<string, number[]>()
  for (const entry of entriesWithWeight(entries)) {
    const weekKey = format(parseISO(entry.date), 'yyyy-ww')
    buckets.set(weekKey, [...(buckets.get(weekKey) ?? []), entry.weight_kg ?? 0])
  }

  return [...buckets.entries()].map(([week, weights]) => ({
    week,
    weight: Number((weights.reduce((sum, weight) => sum + weight, 0) / weights.length).toFixed(1)),
  }))
}

export function macroCompletion(actual: number | null | undefined, target: number) {
  if (!actual) return 0
  return Math.min(150, Math.round((actual / target) * 100))
}
