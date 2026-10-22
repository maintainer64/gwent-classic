import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CardInfo } from '../domain/types'
import { ABILITIES } from './ru'

export type CardLanguage = 'ru' | 'en'
const englishAbilities: Record<string, string> = {
  hero: 'Hero',
  spy: 'Spy',
  muster: 'Muster',
  medic: 'Medic',
  bond: 'Tight Bond',
  morale: 'Morale Boost',
  horn: "Commander's Horn",
  decoy: 'Decoy',
  scorch: 'Scorch',
  scorch_c: 'Close Combat Scorch',
  scorch_r: 'Ranged Scorch',
  scorch_s: 'Siege Scorch',
  frost: 'Biting Frost',
  fog: 'Impenetrable Fog',
  rain: 'Torrential Rain',
  storm: 'Skellige Storm',
  clear: 'Clear Weather',
  berserker: 'Berserker',
  mardroeme: 'Mardroeme',
  avenger: 'Avenger',
  avenger_kambi: 'Avenger',
  vildkarrl: 'Vildkaarl',
}
const rows = {
  ru: {
    close: 'Ближний бой',
    ranged: 'Дальний бой',
    siege: 'Осада',
    agile: 'Ближний или дальний бой',
    weather: 'Погодная карта',
    special: 'Особая карта',
    leader: 'Лидер',
    unit: 'Отряд',
  },
  en: {
    close: 'Close combat',
    ranged: 'Ranged',
    siege: 'Siege',
    agile: 'Close combat or ranged',
    weather: 'Weather card',
    special: 'Special card',
    leader: 'Leader',
    unit: 'Unit',
  },
}
const factions: Record<CardLanguage, Record<string, string>> = {
  ru: {
    realms: 'Королевства Севера',
    nilfgaard: 'Нильфгаард',
    monsters: 'Чудовища',
    scoiatael: 'Скоя’таэли',
    skellige: 'Скеллиге',
    neutral: 'Нейтральная карта',
    special: 'Особая карта',
    weather: 'Погодная карта',
  },
  en: {
    realms: 'Northern Realms',
    nilfgaard: 'Nilfgaard',
    monsters: 'Monsters',
    scoiatael: 'Scoia’tael',
    skellige: 'Skellige',
    neutral: 'Neutral card',
    special: 'Special card',
    weather: 'Weather card',
  },
}
export const cardName = (card: Pick<CardInfo, 'name' | 'nameRu'>, language: CardLanguage) =>
  language === 'ru' ? card.nameRu || card.name : card.name
export const cardDescription = (
  card: Pick<CardInfo, 'description' | 'descriptionEn'>,
  language: CardLanguage,
) => (language === 'ru' ? card.description : card.descriptionEn || card.description)
export const cardAbilities = (value: string, language: CardLanguage) =>
  value
    .split(' ')
    .map((key) => (language === 'ru' ? ABILITIES : englishAbilities)[key])
    .filter(Boolean)
    .join(' · ')

const Context = createContext<{
  language: CardLanguage
  setLanguage: (value: CardLanguage) => void
}>({ language: 'ru', setLanguage: () => {} })
export function CardLanguageProvider({ children }: { children: ReactNode }) {
  const [language, update] = useState<CardLanguage>(() => {
    try {
      return localStorage.getItem('gwent-card-language') === 'en' ? 'en' : 'ru'
    } catch {
      return 'ru'
    }
  })
  const setLanguage = (value: CardLanguage) => {
    update(value)
    try {
      localStorage.setItem('gwent-card-language', value)
    } catch {
      /* Keep the session selection. */
    }
  }
  return <Context.Provider value={{ language, setLanguage }}>{children}</Context.Provider>
}
export function useCardText() {
  const context = useContext(Context)
  return {
    ...context,
    name: (card: Pick<CardInfo, 'name' | 'nameRu'>) => cardName(card, context.language),
    description: (card: Pick<CardInfo, 'description' | 'descriptionEn'>) =>
      cardDescription(card, context.language),
    abilities: (value: string) => cardAbilities(value, context.language),
    row: (value: string) =>
      rows[context.language][value as keyof typeof rows.ru] || rows[context.language].special,
    faction: (value: string) =>
      factions[context.language][value] || factions[context.language].neutral,
  }
}
export function CardLanguageToggle() {
  const { language, setLanguage } = useCardText()
  return (
    <div
      className="card-language-toggle"
      role="group"
      aria-label="Язык карт"
      title="Язык карт / Card language"
    >
      {(['ru', 'en'] as const).map((value) => (
        <button
          type="button"
          key={value}
          aria-pressed={language === value}
          onClick={() => setLanguage(value)}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
