import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties } from 'react'
import type { MatchEvent } from '../../domain/types'

const labels: Record<string, string> = {
  frost: 'Мороз',
  fog: 'Мгла',
  rain: 'Дождь',
  storm: 'Шторм',
  clear: 'Ясная погода',
}
export function weatherKind(ability: string): string {
  return (
    ['storm', 'clear', 'frost', 'fog', 'rain'].find((kind) => ability.split(' ').includes(kind)) ??
    (ability === 'foltest_lord' ? 'clear' : '')
  )
}
// Fixed seeds keep particles stable when scores change, with different phases
// on each row. CSS does all frame-by-frame work, including wind and depth.
function WeatherParticles({ weather, seed }: { weather: string; seed: number }) {
  const snow = weather === 'frost'
  const count = snow ? 24 : weather === 'storm' ? 48 : weather === 'rain' ? 36 : 0
  return (
    <span className="weather-particles" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const n = i + seed * 17
        const depth = i % 3
        const duration = snow ? 3.2 + ((n * 7) % 19) / 10 : 0.58 + ((n * 7) % 11) / 20
        const style = {
          left: `${(n * 37.73) % 100}%`,
          '--size': `${snow ? 4 + depth * 2.5 : 6 + depth * 3}px`,
          '--length': `${28 + depth * 14}px`,
          '--alpha': 0.28 + depth * 0.22,
          '--duration': `${duration}s`,
          '--delay': `${-((n * 0.791) % duration)}s`,
          '--drift': `${snow ? 10 + ((n * 11) % 28) : weather === 'storm' ? -48 : -26}px`,
          '--sway': `${4 + (n % 9)}px`,
        } as CSSProperties
        return <span key={i} className="weather-particle" style={style} />
      })}
    </span>
  )
}
export function RowWeather({ weather, seed = 0 }: { weather: string; seed?: number }) {
  return (
    <AnimatePresence initial={false}>
      {weather && (
        <motion.div
          key={weather}
          className={`row-weather row-weather-${weather}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          role="img"
          aria-label={`Эффект ряда: ${labels[weather]}`}
        >
          <span className="weather-texture" />
          {(weather === 'fog' || weather === 'storm') && (
            <span className="weather-mist" aria-hidden="true">
              {[0, 1, 2].map((layer) => (
                <span
                  key={layer}
                  className="weather-mist-layer"
                  style={{ animationDelay: `${-(seed * 3.7 + layer * 9.2)}s` }}
                />
              ))}
            </span>
          )}
          <WeatherParticles weather={weather} seed={seed} />
          <span className="weather-badge">
            <img src={`/img/icons/card_ability_${weather}.png`} alt="" />
            {labels[weather]}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
export function WeatherResolution({ event }: { event: MatchEvent | null }) {
  const kind = event?.type === 'weather' ? weatherKind(event.card?.ability ?? '') : ''
  return (
    <AnimatePresence>
      {kind && (
        <motion.div
          key={event!.id}
          className={`weather-resolution weather-resolution-${kind}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          role="status"
        >
          <img src={`/img/icons/card_ability_${kind}.png`} alt="" />
          <strong>{labels[kind]}</strong>
          <span>
            {kind === 'clear' ? 'Погодные эффекты сняты' : 'Погода действует на ряды обоих игроков'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
