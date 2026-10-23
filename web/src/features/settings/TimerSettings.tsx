import type { TurnTimer } from '../../domain/types'

export type TimerDraft = { timerMinutes: string; timerMode: TurnTimer['mode'] }
export function parseTimer(value: TimerDraft): TurnTimer | null {
  const minutes = Number(value.timerMinutes)
  return value.timerMinutes.trim() && Number.isFinite(minutes) && minutes >= 0
    ? { minutes, mode: value.timerMode }
    : null
}
export const timerLabel = (timer: TurnTimer = { minutes: 1, mode: 'hard' }) =>
  timer.minutes === 0
    ? 'Без ограничения времени'
    : `${timer.minutes.toLocaleString('ru-RU')} мин · ${timer.mode === 'soft' ? 'мягкий' : 'жёсткий'}`

export function TimerSettings({
  value,
  onChange,
}: {
  value: TimerDraft
  onChange: (patch: Partial<TimerDraft>) => void
}) {
  const timer = parseTimer(value)
  return (
    <section className="timer-settings" aria-label="Настройки таймера">
      <h3>Время на ход</h3>
      <label>
        Минут на ход
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={value.timerMinutes}
          aria-invalid={!timer}
          onChange={(e) => onChange({ timerMinutes: e.target.value })}
        />
      </label>
      <small>Любое число минут. 0 — без таймера.</small>
      <div className="segmented" role="group" aria-label="Режим таймера">
        {(['soft', 'hard'] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            className={value.timerMode === mode ? 'active' : ''}
            aria-pressed={value.timerMode === mode}
            disabled={timer?.minutes === 0}
            onClick={() => onChange({ timerMode: mode })}
          >
            {mode === 'soft' ? 'Мягкий' : 'Жёсткий'}
          </button>
        ))}
      </div>
      <p>
        {!timer
          ? 'Введите число минут от нуля.'
          : timer.minutes === 0
            ? 'Играйте в своём темпе.'
            : value.timerMode === 'soft'
              ? 'Звуковое и цветовое предупреждение. После сигнала можно продолжать ход.'
              : 'Когда время закончится, сервер автоматически объявит пас.'}
      </p>
    </section>
  )
}
