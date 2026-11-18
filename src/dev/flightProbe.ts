import { router, useRoute } from 'expo-router'
import { useEffect, useSyncExternalStore } from 'react'
import { useFrameCallback, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

const WINDOW_MS = 900
const CYCLE = ['full', 'no-content', 'no-hero', 'empty'] as const
const REPS = 3

export type Variant = 'warmup' | (typeof CYCLE)[number]

let nextVariant: Variant = 'warmup'
let started = false
let sheetsHidden = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setSheetsHidden(hidden: boolean) {
  sheetsHidden = hidden
  listeners.forEach((listener) => listener())
}

function useDevSheetsHidden() {
  return useSyncExternalStore(subscribe, () => sheetsHidden)
}

/** In a release build, always false: the sheets stay on. */
export const useSheetsHidden = __DEV__ ? useDevSheetsHidden : () => false

// Keyed by route key: StrictMode runs render twice.
const assigned = new Map<string, { variant: Variant; sheets: boolean }>()

function assign(key: string) {
  let entry = assigned.get(key)
  if (!entry) {
    entry = { variant: nextVariant, sheets: !sheetsHidden }
    assigned.set(key, entry)
  }
  return entry
}

function report(
  variant: Variant,
  sheets: boolean,
  frames: number,
  max: number,
  long: string,
) {
  console.log(
    `[flight] ${variant} sheets=${sheets ? 'on' : 'off'} frames=${frames} max=${Math.round(max)}ms long(at:ms)=${long || 'none'}`,
  )
}

function useDevFlightProbe() {
  const { key } = useRoute()
  const { variant, sheets } = assign(key)
  const frames = useSharedValue(0)
  const max = useSharedValue(0)
  const long = useSharedValue('')
  const done = useSharedValue(false)

  useFrameCallback(({ timeSincePreviousFrame, timeSinceFirstFrame }) => {
    'worklet'
    if (done.value) return
    if (timeSincePreviousFrame !== null) {
      frames.value += 1
      if (timeSincePreviousFrame > max.value) max.value = timeSincePreviousFrame
      if (timeSincePreviousFrame > 20) {
        long.value += `${Math.round(timeSinceFirstFrame)}:${Math.round(timeSincePreviousFrame)} `
      }
    }
    if (timeSinceFirstFrame > WINDOW_MS) {
      done.value = true
      scheduleOnRN(report, variant, sheets, frames.value, max.value, long.value)
    }
  })

  return { variant }
}

const RELEASE_PROBE: { variant: Variant } = { variant: 'warmup' }

/** In a release build, always the full screen, with no frame callback. */
export const useFlightProbe = __DEV__
  ? useDevFlightProbe
  : () => RELEASE_PROBE

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function open(id: string, variant: Variant) {
  nextVariant = variant
  router.push(`/trek/${id}`)
  await wait(2200)
  router.back()
  await wait(2000)
}

async function drive(id: string) {
  await wait(4000)
  await open(id, 'warmup')
  await open(id, 'warmup')
  for (const sheets of [true, false]) {
    setSheetsHidden(!sheets)
    await wait(3000)
    for (let rep = 0; rep < REPS; rep++) {
      for (const variant of CYCLE) await open(id, variant)
    }
  }
  setSheetsHidden(false)
  nextVariant = 'warmup'
  console.log('[flight] done')
}

/** In a dev build only, opens and closes the first card by itself, once per app load. */
export function useFlightDriver(firstId: string | undefined, ready: boolean) {
  useEffect(() => {
    if (!__DEV__ || !ready || !firstId || started) return
    started = true
    void drive(firstId)
  }, [firstId, ready])
}
