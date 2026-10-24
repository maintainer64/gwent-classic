import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { MatchEvent, Move, Room } from '../../domain/types'
const eventDuration: Record<string, number> = {
  played: 260,
  placed: 540,
  draw: 360,
  destroyed: 340,
  transform: 420,
  leader: 520,
  round_end: 1100,
  resolved: 90,
  weather: 1250,
}
export function useMatch() {
  const [room, setRoom] = useState<Room | null>(null),
    [display, setDisplay] = useState<Room | null>(null),
    [event, setEvent] = useState<MatchEvent | null>(null),
    [busy, setBusy] = useState(false),
    [animating, setAnimating] = useState(false),
    [live, setLive] = useState(false),
    [error, setError] = useState('')
  const visual = useRef<Room | null>(null)
  const current = useRef<Room | null>(null),
    watch = useRef<(() => void) | null>(null),
    queue = useRef<MatchEvent[]>([]),
    running = useRef(false),
    session = useRef(0),
    epoch = useRef(0),
    seen = useRef(0),
    locked = useRef(false)
  const process = useCallback(async () => {
    if (running.current) return
    running.current = true
    const generation = epoch.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setAnimating(true)
    while (queue.current.length && generation === epoch.current) {
      const next = queue.current.shift()!,
        latest = current.current
      if (!latest) break
      setEvent(next)
      let hand =
        visual.current?.players[latest.seat]?.hand ?? latest.players[latest.seat]?.hand ?? []
      if ((next.type === 'placed' || next.type === 'weather') && next.card)
        hand = hand.filter((c) => c.uid !== next.card!.uid)
      if (
        next.type === 'draw' &&
        next.actor === latest.seat &&
        next.card &&
        !hand.some((c) => c.uid === next.card!.uid)
      )
        hand = [...hand, next.card]
      if ((next.type === 'resolved' || next.type === 'leader') && next.actor === latest.seat)
        hand = latest.players[latest.seat].hand ?? []
      const frame = {
        ...latest,
        ...next.frame,
        weatherCards: next.frame.weatherCards ?? [],
        players: next.frame.players.map((p, i) => ({
          ...p,
          hand: i === latest.seat ? hand : undefined,
          deckChoices: i === latest.seat ? latest.players[i]?.deckChoices : undefined,
          peek: i === latest.seat ? latest.players[i]?.peek : undefined,
        })),
      }
      visual.current = frame
      setDisplay(frame)
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          reduced ? (next.type === 'weather' ? 650 : 40) : (eventDuration[next.type] ?? 250),
        ),
      )
    }
    if (generation === epoch.current) {
      running.current = false
      visual.current = current.current
      setDisplay(current.current)
      setEvent(null)
      setAnimating(false)
    }
  }, [])
  const accept = useCallback(
    (next: Room, _snapshot = false) => {
      if (!current.current || next.code !== current.current.code) return
      if (next.version < current.current.version) return
      const preparing =
        next.phase === 'mulligan' &&
        (current.current.phase !== 'mulligan' ||
          current.current.status === 'waiting' ||
          next.gameNumber !== current.current.gameNumber)
      current.current = next
      setRoom(next)
      if (preparing) {
        epoch.current++
        queue.current = []
        running.current = false
        seen.current = next.eventSeq
        visual.current = next
        setDisplay(next)
        setEvent(null)
        setAnimating(false)
        return
      }
      const events = (next.transitions ?? []).filter((e) => e.id > seen.current)
      seen.current = next.eventSeq
      queue.current.push(...events)
      if (events.length) void process()
      else if (!running.current) {
        visual.current = next
        setDisplay(next)
      }
    },
    [process],
  )
  const leave = useCallback(() => {
    watch.current?.()
    watch.current = null
    session.current++
    epoch.current++
    queue.current = []
    running.current = false
    current.current = null
    visual.current = null
    setRoom(null)
    setDisplay(null)
    setEvent(null)
    setAnimating(false)
    setBusy(false)
    locked.current = false
    setError('')
    setLive(false)
  }, [])
  const enter = useCallback(
    (next: Room) => {
      leave()
      current.current = next
      visual.current = next
      seen.current = next.eventSeq
      setRoom(next)
      setDisplay(next)
      watch.current = api.watch(next.code, accept, setLive)
    },
    [accept, leave],
  )
  const send = useCallback(
    async (move: Move) => {
      if (!current.current || locked.current) return
      locked.current = true
      setBusy(true)
      setError('')
      const code = current.current.code,
        generation = session.current
      try {
        let next: Room
        try {
          next = await api.move(code, current.current.version, move)
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err
          const fresh = await api.getRoom(code)
          if (session.current !== generation || current.current?.code !== code) return
          accept(fresh, true)
          // Ready is safe to retry after a competing redraw/ready. A card play is not.
          if (move.type === 'rematch') {
            if (fresh.status !== 'finished' || fresh.rematchReady?.[fresh.seat]) return
            next = await api.move(code, fresh.version, move)
          } else if (
            move.type === 'ready' &&
            fresh.phase === 'mulligan' &&
            !fresh.players[fresh.seat].ready
          )
            next = await api.move(code, fresh.version, move)
          else if (move.type === 'ready' && fresh.players[fresh.seat].ready) return
          else throw err
        }
        if (session.current === generation && current.current?.code === code) accept(next)
      } catch (err) {
        if (session.current === generation && current.current?.code === code) {
          setError(err instanceof Error ? err.message : 'Не удалось выполнить ход.')
          try {
            const fresh = await api.getRoom(code)
            if (session.current === generation && current.current?.code === code)
              accept(fresh, true)
          } catch {
            /* Retain the last visible snapshot. */
          }
        }
      } finally {
        if (session.current === generation) {
          locked.current = false
          setBusy(false)
        }
      }
    },
    [accept],
  )
  useEffect(() => leave, [leave])
  return {
    room,
    display,
    event,
    busy,
    animating,
    live,
    error,
    enter,
    leave,
    send,
  }
}
