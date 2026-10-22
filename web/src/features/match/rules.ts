import type { BattleRow, GameCard, Player } from '../../domain/types'
export const has = (card: { ability: string }, ability: string) =>
  card.ability.split(' ').includes(ability)
export const isUnit = (card: GameCard) =>
  ['close', 'ranged', 'siege', 'agile'].includes(card.row) && !has(card, 'hero')
export function legalRows(card: GameCard, me: Player): BattleRow[] {
  if (card.row === 'weather' || has(card, 'decoy') || (card.special && has(card, 'scorch')))
    return []
  if (card.special && (has(card, 'horn') || has(card, 'mardroeme')))
    return (['close', 'ranged', 'siege'] as const).filter((row) => !me.special[row]?.length)
  if (card.row === 'agile') return ['close', 'ranged']
  return ['close', 'ranged', 'siege'].includes(card.row) ? [card.row as BattleRow] : []
}
