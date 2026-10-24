import { useRef, useState } from 'react'
import type { Room } from '../../domain/types'

export function Invitation({ room }: { room: Room }) {
  const input = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState('')
  const link = `${location.origin}/room/${room.code}`
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error()
      await navigator.clipboard.writeText(link)
      setCopied('Ссылка скопирована')
    } catch {
      input.current?.focus()
      input.current?.select()
      input.current?.setSelectionRange(0, link.length)
      setCopied('Ссылка выделена — скопируйте её')
    }
  }
  return (
    <section className="early-invitation" aria-label="Приглашение в комнату">
      <p className="eyebrow">Комната {room.code}</p>
      <h2>Приглашение готово</h2>
      <p>Отправьте ссылку другу. Он уже может подключиться, пока вы выбираете колоду.</p>
      <label>
        Ссылка приглашения
        <input
          ref={input}
          id="invite-link"
          readOnly
          value={link}
          onClick={(e) => e.currentTarget.select()}
        />
      </label>
      <button
        className="button quiet full"
        type="button"
        onClick={() => {
          void copy()
        }}
      >
        Скопировать приглашение
      </button>
      <p className="invitation-status" role="status">
        {room.players[1]
          ? `${room.players[1].name} подключился. Подтвердите свою готовность.`
          : 'Ожидаем друга. Вы можете продолжить подготовку.'}
      </p>
      {copied && (
        <p className="invitation-copy-status" role="status">
          {copied}
        </p>
      )}
    </section>
  )
}
