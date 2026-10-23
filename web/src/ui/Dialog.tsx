import { useEffect, useRef, type ReactNode } from 'react'
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = '',
  closeOnBackdrop = true,
}: {
  title: string
  children: ReactNode
  onClose?: () => void
  wide?: boolean
  className?: string
  closeOnBackdrop?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = ref.current!
    node.showModal()
    return () => node.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''} ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose?.()
      }}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.()
      }}
    >
      <header>
        <h2>{title}</h2>
        {onClose && (
          <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      {children}
    </dialog>
  )
}
