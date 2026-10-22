import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  settings: (
    <>
      <path d="M3 6h7m4 0h7M3 12h2m4 0h12M3 18h10m4 0h4" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2" />
    </>
  ),
  sound: (
    <>
      <path d="m11 4-5 4H3v8h3l5 4V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </>
  ),
  muted: (
    <>
      <path d="m11 4-5 4H3v8h3l5 4V4ZM16 9l5 6M21 9l-5 6" />
    </>
  ),
  expand: <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />,
  link: (
    <>
      <path
        d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(0 0) scale(.95)"
      />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z" />
    </>
  ),
  left: <path d="m14 5-7 7 7 7" />,
  right: <path d="m10 5 7 7-7 7" />,
}

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
