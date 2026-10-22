import type {
  BotSettings,
  Catalog,
  DeckEntry,
  Faction,
  MatchMode,
  Move,
  Room,
  RoomSummary,
  TurnTimer,
} from '../domain/types'
import { ERROR_TEXT } from '../i18n/ru'
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(ERROR_TEXT[code] ?? ERROR_TEXT.server_error)
  }
}
async function request<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new ApiError(0, 'network')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ApiError(response.status, 'server_error')
  }
  if (!response.ok) {
    const code =
      (data as { code?: string }).code ??
      (
        {
          403: 'forbidden',
          404: 'not_found',
          410: 'expired',
          409: 'conflict',
          429: 'rate_limit',
        } as Record<number, string>
      )[response.status] ??
      'invalid_move'
    throw new ApiError(response.status, code)
  }
  return data as T
}
export const api = {
  catalog: () => request<Catalog>('/api/catalog'),
  rooms: () => request<{ rooms: RoomSummary[] }>('/api/rooms'),
  getRoom: (code: string) => request<Room>(`/api/rooms/${code}`),
  create: (payload: {
    name: string
    faction: Faction
    leader: number
    mode: MatchMode
    bot?: BotSettings
    timer?: TurnTimer
    deck: DeckEntry[]
  }) => request<Room>('/api/rooms', 'POST', payload),
  join: (
    code: string,
    payload: {
      name: string
      faction: Faction
      leader: number
      expectedVersion: number
      deck: DeckEntry[]
    },
  ) => request<Room>(`/api/rooms/${code}/join`, 'POST', payload),
  move: (code: string, version: number, action: Move) =>
    request<Room>(`/api/rooms/${code}/actions`, 'POST', {
      expectedVersion: version,
      action,
    }),
  watch(
    code: string,
    onRoom: (room: Room, snapshot: boolean) => void,
    onStatus: (live: boolean) => void,
  ): () => void {
    let socket: WebSocket | null = null,
      closed = false,
      retry = 0,
      attempt = 0
    const schedule = () => {
      window.clearTimeout(retry)
      if (!closed && navigator.onLine)
        retry = window.setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++))
    }
    const connect = () => {
      if (closed || socket) return
      window.clearTimeout(retry)
      let ws: WebSocket
      try {
        ws = new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${code}/ws`,
        )
      } catch {
        schedule()
        return
      }
      socket = ws
      let first = true
      ws.onopen = () => {
        if (socket !== ws) return
        attempt = 0
        onStatus(true)
      }
      ws.onmessage = (e) => {
        if (socket !== ws || closed) return
        let next: Room
        try {
          next = JSON.parse(String(e.data)) as Room
        } catch {
          return
        }
        if (next.code !== code || !Number.isInteger(next.version) || !Array.isArray(next.players))
          return
        onRoom(next, first)
        first = false
      }
      ws.onclose = () => {
        if (socket !== ws) return
        socket = null
        onStatus(false)
        schedule()
      }
      ws.onerror = () => {
        /* Close handles reconnect. */
      }
    }
    const offline = () => {
      window.clearTimeout(retry)
      const ws = socket
      socket = null
      ws?.close()
      onStatus(false)
    }
    const online = () => {
      if (!closed) {
        window.clearTimeout(retry)
        connect()
      }
    }
    const visible = () => {
      if (document.hidden) return
      if (socket?.readyState === WebSocket.OPEN) socket.send('sync')
      else online()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      const ws = socket
      socket = null
      ws?.close()
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
    }
  },
}
