export type Faction = 'realms' | 'nilfgaard' | 'monsters' | 'scoiatael' | 'skellige'
export type BattleRow = 'close' | 'ranged' | 'siege'
export type MatchMode = 'bot' | 'pvp'
export type TurnTimer = { minutes: number; mode: 'soft' | 'hard' }
export type BotDifficulty = 'easy' | 'normal' | 'hard'
export type BotStyle = 'balanced' | 'aggressive' | 'economy'
export type CardInfo = {
  key: string
  name: string
  nameRu: string
  description: string
  descriptionEn: string
  power: number
  basePower?: number
  ability: string
  row: string
  image: string
  faction: string
}
export type GameCard = CardInfo & {
  uid: string
  def: number
  special: boolean
}
export type DeckCard = CardInfo & {
  id: number
  faction: string
  maxCopies: number
}
export type LeaderChoice = {
  id: number
  key: string
  name: string
  nameRu: string
  image: string
  faction: Faction
  ability: string
  description: string
  descriptionEn: string
  passive: boolean
}
export type Catalog = {
  cards: DeckCard[]
  leaders: LeaderChoice[]
  factions: Faction[]
}
export type DeckEntry = { key?: string; def: number; count: number }
export type Player = {
  name: string
  faction: Faction
  hand?: GameCard[]
  handCount: number
  deckCount: number
  score: number
  rows: Record<BattleRow, GameCard[]>
  special: Record<BattleRow, GameCard[]>
  grave: GameCard[]
  deckChoices?: GameCard[]
  peek?: GameCard[]
  passed: boolean
  wins: number
  lives: number
  leader: string
  leaderId: number
  leaderRu: string
  leaderDescription: string
  leaderPassive: boolean
  leaderUsed: boolean
  ready: boolean
  redraws: number
}
export type BotSettings = {
  difficulty: BotDifficulty
  style: BotStyle
  deckMode: 'random' | 'faction' | 'custom'
  faction?: Faction
  leader?: number
  deck?: DeckEntry[]
}
export type BoardFrame = {
  players: Player[]
  weather: string[]
  round: number
  status: 'waiting' | 'playing' | 'finished'
  weatherCards?: GameCard[]
}
export type MatchEvent = {
  id: number
  type: string
  actor: number
  card?: GameCard
  row?: BattleRow
  frame: BoardFrame
}
export type Room = BoardFrame & {
  lobby?: boolean
  lobbyReady?: boolean[]
  gameNumber?: number
  rematchReady?: boolean[]
  code: string
  mode: MatchMode
  phase: 'mulligan' | 'turn'
  version: number
  expiresAt: string
  timer?: TurnTimer
  turnDeadline?: string
  serverTime: string
  seat: number
  turn: number
  initiative: number
  pendingOwner?: number
  roundHistory?: { scoreA: number; scoreB: number; winner: number }[]
  winner: number
  weatherCards?: GameCard[]
  events: string[]
  eventSeq: number
  transitions?: MatchEvent[]
  bot?: BotSettings
}
export type RoomSummary = {
  code: string
  mode: MatchMode
  status: 'waiting' | 'playing' | 'finished'
  players: number
  name: string
  expiresAt: string
}
export type Move = {
  type: 'pass' | 'play' | 'leader' | 'initiative' | 'redraw' | 'ready' | 'revive' | 'rematch'
  uid?: string
  row?: string
  target?: string
  targetRow?: string
  targets?: string[]
  draw?: string
}
export const FACTIONS: Record<Faction, string> = {
  realms: 'Королевства Севера',
  nilfgaard: 'Нильфгаард',
  monsters: 'Чудовища',
  scoiatael: 'Скоя’таэли',
  skellige: 'Скеллиге',
}
export const PERKS: Record<Faction, string> = {
  realms: 'Дополнительная карта после победы в раунде.',
  nilfgaard: 'Побеждает при равном счёте в раунде.',
  monsters: 'Один случайный отряд остаётся на поле после раунда.',
  scoiatael: 'Выбирает, кто начинает партию.',
  skellige: 'Два случайных отряда из сброса возвращаются в третьем раунде.',
}
export const COLORS: Record<Faction, string> = {
  realms: '#79a7d1',
  nilfgaard: '#dbbd70',
  monsters: '#dc897e',
  scoiatael: '#85b998',
  skellige: '#b29cdb',
}
export const SYMBOLS: Record<Faction, string> = {
  realms: '⚜',
  nilfgaard: '☀',
  monsters: '♜',
  scoiatael: '❧',
  skellige: '⚓',
}
export const ROWS: Record<BattleRow, string> = {
  close: 'Ближний бой',
  ranged: 'Дальний бой',
  siege: 'Осада',
}
export const ROW_ICONS: Record<string, string> = {
  close: '⚔',
  ranged: '➶',
  siege: '♜',
  agile: '⇄',
  weather: '☁',
  leader: '♛',
}
export const DIFFICULTIES: Record<BotDifficulty, string> = {
  easy: 'Лёгкая',
  normal: 'Обычная',
  hard: 'Сложная',
}
export const STYLES: Record<BotStyle, string> = {
  balanced: 'Универсальный',
  aggressive: 'Агрессивный',
  economy: 'Бережливый',
}
export const STYLES_HELP: Record<BotStyle, string> = {
  balanced: 'Учитывает силу поля и эффекты карт.',
  aggressive: 'Больше ценит немедленную силу на поле.',
  economy: 'Бережёт сильные карты и чаще уступает невыгодный раунд.',
}
