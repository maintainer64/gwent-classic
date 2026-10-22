import type { TurnTimer } from '../../domain/types'
import { CardLanguageToggle } from '../../i18n/cards'
import { Dialog } from '../../ui/Dialog'
import { AudioSettings } from './Audio'
import { TimerSettings, timerLabel, type TimerDraft } from './TimerSettings'

export function Settings({
  timer,
  onTimer,
  activeTimer,
  onClose,
}: {
  timer: TimerDraft
  onTimer: (patch: Partial<TimerDraft>) => void
  activeTimer?: TurnTimer
  onClose: () => void
}) {
  return (
    <Dialog title="Настройки" className="preferences-dialog" onClose={onClose}>
      <AudioSettings />
      {activeTimer ? (
        <section className="active-timer-settings">
          <h3>Таймер партии</h3>
          <p>{timerLabel(activeTimer)}</p>
          <small>Выбирается создателем перед началом партии.</small>
        </section>
      ) : (
        <TimerSettings value={timer} onChange={onTimer} />
      )}
      <section className="language-settings">
        <h3>Язык карт</h3>
        <CardLanguageToggle />
      </section>
    </Dialog>
  )
}
