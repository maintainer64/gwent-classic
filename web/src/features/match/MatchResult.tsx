import { useEffect } from 'react'
import { FACTIONS, type Room } from '../../domain/types'
import { Dialog } from '../../ui/Dialog'
import { useAudio } from '../settings/Audio'

export function MatchResult({
  room,
  onHome,
  onRematch,
  busy = false,
  live = true,
  error = '',
}: {
  room: Room
  onHome: () => void
  onRematch: () => void
  busy?: boolean
  live?: boolean
  error?: string
}) {
  const result = room.winner < 0 ? 'draw' : room.winner === room.seat ? 'win' : 'lose'
  const title =
    result === 'win'
      ? 'Победа за вами'
      : result === 'draw'
        ? 'Достойная ничья'
        : 'Соперник оказался сильнее'
  const { playEffect } = useAudio()
  useEffect(() => {
    playEffect(result === 'win' ? 'game_win' : 'game_lose')
  }, [result, playEffect])
  return (
    <Dialog
      title={title}
      className={`match-result result-${result}`}
      onClose={onHome}
      closeOnBackdrop={false}
      wide
    >
      <div className="match-result-content">
        <p className="result-kicker">Гвинт · Итоги партии</p>
        <div className="result-emblem">
          <img src={`/img/icons/end_${result}.png`} alt="" />
          <h2>{result === 'win' ? 'Победа' : result === 'lose' ? 'Поражение' : 'Ничья'}</h2>
        </div>
        <table className="results-table" aria-label="Результаты раундов">
          <thead>
            <tr>
              <th scope="col">Игрок</th>
              {room.roundHistory?.map((_, i) => (
                <th scope="col" key={i}>
                  {i + 1} раунд
                </th>
              ))}
              <th scope="col" className="result-wins-heading">
                Победы
              </th>
            </tr>
          </thead>
          <tbody>
            {[room.seat, 1 - room.seat].map((seat) => {
              const player = room.players[seat]
              return (
                <tr key={seat} data-result-seat={seat}>
                  <th scope="row">
                    <div className="result-player">
                      <img src={`/img/icons/deck_shield_${player.faction}.png`} alt="" />
                      <div>
                        <strong title={player.name}>{player.name}</strong>
                        <span>
                          {seat === room.seat ? 'Вы' : 'Соперник'} · {FACTIONS[player.faction]}
                        </span>
                      </div>
                    </div>
                  </th>
                  {room.roundHistory?.map((round, i) => (
                    <td
                      key={i}
                      data-round={i + 1}
                      className={round.winner === seat ? 'winner' : round.winner < 0 ? 'tied' : ''}
                    >
                      {seat === 0 ? round.scoreA : round.scoreB}
                    </td>
                  ))}
                  <td
                    className={`result-wins ${seat === room.winner ? 'winner' : ''}`}
                    aria-label={`Побед в раундах: ${player.wins}`}
                  >
                    {player.wins}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="result-divider" aria-hidden="true">
          <span />
        </div>
        <div className="result-actions">
          <button className="button quiet" onClick={onHome}>
            В главное меню
          </button>
          <button
            className="button primary"
            disabled={busy || !live || !!room.rematchReady?.[room.seat]}
            onClick={onRematch}
          >
            {room.rematchReady?.[room.seat]
              ? 'Ждём соперника…'
              : room.rematchReady?.[1 - room.seat]
                ? 'Принять реванш'
                : 'Реванш'}
          </button>
        </div>
        {error && (
          <p className="result-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
