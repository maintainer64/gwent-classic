import { useEffect, useRef, useState } from 'react'
import type { MatchEvent, Room } from '../../domain/types'
import { useAudio } from '../settings/Audio'

type Announcement = { key: string; text: string; icon: string; sound: string; turn?: boolean }

function announcement(event: MatchEvent, seat: number): Announcement | null {
  const me = event.actor === seat
  const result = event.actor < 0 ? 'draw' : me ? 'win' : 'lose'
  const messages: Record<string, Omit<Announcement, 'key'>> = {
    round_start: {
      text:
        event.frame.round === 1
          ? me
            ? 'Вы начинаете партию'
            : 'Соперник начинает партию'
          : `Раунд ${event.frame.round} · ${me ? 'Вы ходите первым' : 'Соперник ходит первым'}`,
      icon: event.frame.round === 1 ? `notif_${me ? 'me' : 'op'}_coin` : 'notif_round_start',
      sound: event.frame.round === 1 ? 'game_start' : 'round1_start',
    },
    round_end: {
      text:
        event.actor < 0 ? 'Раунд завершён вничью' : me ? 'Вы выиграли раунд' : 'Вы проиграли раунд',
      icon: `notif_${result}_round`,
      sound: me ? 'round_win' : 'round_lose',
    },
    match_end: {
      text: event.actor < 0 ? 'Ничья' : me ? 'Победа за вами' : 'Поражение',
      icon: `end_${result}`,
      sound: me ? 'game_win' : 'game_lose',
    },
    pass: {
      text: me ? 'Вы пасуете' : 'Соперник пасует',
      icon: 'notif_round_passed',
      sound: 'pass',
    },
    timeout: {
      text: me ? 'Ваше время вышло' : 'Время соперника вышло',
      icon: `notif_${me ? 'me' : 'op'}_turn`,
      sound: 'warning',
    },
  }
  const message = messages[event.type]
  return message ? { ...message, key: `event-${event.id}` } : null
}

// Read authoritative history independently of card motion: reduced-motion users
// still see who starts. A restored snapshot establishes the cursor, never replays it.
export function MatchAnnouncements({ room, animating }: { room: Room; animating: boolean }) {
  const { playEffect } = useAudio()
  const [queue, setQueue] = useState<Announcement[]>([])
  const cursor = useRef({ code: room.code, seq: room.eventSeq, version: room.version })
  const settled = useRef({ code: room.code, version: room.version })
  const started = useRef<MatchEvent | null>(null)
  const active = queue[0]
  useEffect(() => {
    if (cursor.current.code !== room.code) {
      cursor.current = { code: room.code, seq: room.eventSeq, version: room.version }
      settled.current = { code: room.code, version: room.version }
      started.current = null
      setQueue([])
      return
    }
    const events = (room.transitions ?? []).filter((e) => e.id > cursor.current.seq)
    cursor.current = { code: room.code, seq: room.eventSeq, version: room.version }
    const round = [...events].reverse().find((e) => e.type === 'round_start')
    if (round) started.current = round
    const messages = events
      .map((e) => announcement(e, room.seat))
      .filter((e): e is Announcement => !!e)
    if (messages.length) setQueue((old) => [...old.filter((a) => !a.turn), ...messages])
  }, [room])
  useEffect(() => {
    if (
      animating ||
      room.phase !== 'turn' ||
      room.initiative ||
      room.pendingOwner ||
      room.status !== 'playing'
    )
      return
    if (settled.current.code === room.code && settled.current.version === room.version) return
    settled.current = { code: room.code, version: room.version }
    const first = started.current
    started.current = null
    // The opening banner already names the first player. If a bot has since
    // played, announce the human's turn as well, using the final server state.
    if (
      first &&
      first.actor === room.turn &&
      !(room.transitions ?? []).some(
        (e) => e.id > first.id && ['played', 'leader', 'pass'].includes(e.type),
      )
    )
      return
    const me = room.turn === room.seat
    const message: Announcement = {
      key: `turn-${room.version}`,
      text: me ? 'Ваш ход' : 'Ход соперника',
      icon: `notif_${me ? 'me' : 'op'}_turn`,
      sound: `turn_${me ? 'me' : 'op'}`,
      turn: true,
    }
    setQueue((old) => [...old.filter((a) => !a.turn), message])
  }, [room, animating])
  useEffect(() => {
    if (!active) return
    playEffect(active.sound)
    const timeout = setTimeout(
      () => setQueue((old) => old.filter((a) => a.key !== active.key)),
      active.turn ? 1300 : 1900,
    )
    return () => clearTimeout(timeout)
  }, [active, playEffect])
  return (
    <div className="match-announcements" role="status" aria-live="polite" aria-atomic="true">
      {active && (
        <div className="match-announcement" key={active.key} data-announcement={active.key}>
          <img src={`/img/icons/${active.icon}.png`} alt="" />
          <strong>{active.text}</strong>
        </div>
      )}
    </div>
  )
}
