/** A lightweight particle overlay drawn on one fixed <canvas> above the
 * original DOM battlefield. It never touches the classic elements themselves:
 * the original card art, transitions and weather textures stay the real view,
 * this layer only adds sparks, drifting weather and round-win shimmer.
 * Everything stops when nothing is animating, so an idle board costs nothing. */

type SpawnKind = 'snow' | 'fog' | 'rain' | 'spark' | 'gold' | 'ring'
type AmbientKind = 'snow' | 'fog' | 'rain'

interface Particle {
  kind: SpawnKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
}

export interface AmbientRow { el: HTMLElement; kind: AmbientKind }

const MAX_PARTICLES = 420

export class BoardEffects {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly particles: Particle[] = []
  private rows: AmbientRow[] = []
  private raf = 0
  private last = 0
  private flash = 0
  private spawnAcc = { snow: 0, fog: 0, rain: 0 }
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'classic-fx'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) this.reduced = true
    document.body.appendChild(this.canvas)
    this.resize()
    window.addEventListener('resize', () => this.resize())
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.kick()))
    // Small debug surface for automated checks (particle/ambient counts).
    ;(window as unknown as { __gcFx?: BoardEffects }).__gcFx = this
  }

  /** Counts used by tests and debugging. */
  stats(): { particles: number; rows: number; running: boolean } {
    return { particles: this.particles.length, rows: this.rows.length, running: Boolean(this.raf) }
  }

  /** Weather ambience for rows that currently have an active weather effect.
   * Called on every render; rows are plain DOM references, positions are
   * re-read each frame so board scaling never desyncs the overlay. */
  syncWeather(rows: AmbientRow[]) {
    if (this.reduced) return
    this.rows = rows
    if (rows.length) this.kick()
  }

  /** Fiery sparks bursting where a scorch card landed. */
  scorch(el: HTMLElement) {
    if (this.reduced) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    for (let i = 0; i < 34; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 60 + Math.random() * 240
      this.spawn('spark', cx, cy, Math.cos(angle) * speed, Math.sin(angle) * speed - 80, 0.5 + Math.random() * 0.6, 1 + Math.random() * 2.2)
    }
    this.spawn('ring', cx, cy, 0, 0, 0.45, 12)
    this.flash = Math.min(this.flash + 0.12, 0.3)
    this.kick()
  }

  /** Soft shockwave where a card was just placed: the placement beat from
   * the original playCardAction, without obscuring the card art itself. */
  ring(el: HTMLElement) {
    if (this.reduced) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    this.spawn('ring', cx, cy, 0, 0, 0.5, 14)
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 110
      this.spawn('gold', cx, cy, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.35 + Math.random() * 0.3, 1 + Math.random() * 1.6)
    }
    this.kick()
  }

  /** Golden shimmer celebrating the round winner's side of the board. */
  roundWon(el: HTMLElement) {
    if (this.reduced) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    for (let i = 0; i < 46; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const speed = 80 + Math.random() * 260
      this.spawn('gold', cx, cy, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.7 + Math.random() * 0.8, 1.5 + Math.random() * 2.5)
    }
    this.spawn('ring', cx, cy, 0, 0, 0.7, 16)
    this.flash = Math.min(this.flash + 0.16, 0.35)
    this.kick()
  }

  /** Brief screen wash for storms and the end of the match. */
  wash(strength = 0.25) {
    if (this.reduced) return
    this.flash = Math.min(this.flash + strength, 0.5)
    this.kick()
  }

  private spawn(kind: SpawnKind, x: number, y: number, vx: number, vy: number, life: number, size: number) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
    this.particles.push({ kind, x, y, vx, vy, life, max: life, size })
  }

  private resize() {
    if (!this.ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(window.innerWidth * dpr)
    this.canvas.height = Math.round(window.innerHeight * dpr)
    this.canvas.style.width = `${window.innerWidth}px`
    this.canvas.style.height = `${window.innerHeight}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private kick() {
    if (this.reduced || this.raf || document.hidden) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const ctx = this.ctx
    if (!ctx) return
    const w = window.innerWidth
    const h = window.innerHeight
    ctx.clearRect(0, 0, w, h)
    this.spawnAmbient(dt)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) { this.particles.splice(i, 1); continue }
      p.x += p.vx * dt
      p.y += p.vy * dt
      const alpha = Math.max(0, p.life / p.max)
      switch (p.kind) {
        case 'snow':
          p.vy = Math.min(p.vy + 18 * dt, 46)
          p.x += Math.sin((now + p.size * 600) / 700) * 12 * dt
          ctx.fillStyle = `rgba(232,240,255,${(alpha * 0.85).toFixed(3)})`
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
          break
        case 'fog':
          p.vx *= 0.995
          ctx.fillStyle = `rgba(206,214,232,${(alpha * 0.1).toFixed(3)})`
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
          break
        case 'rain':
          ctx.strokeStyle = `rgba(168,196,255,${(alpha * 0.55).toFixed(3)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05)
          ctx.stroke()
          break
        case 'spark':
          p.vy += 420 * dt
          ctx.fillStyle = `rgba(255,${Math.round(120 + 120 * alpha)},48,${(alpha * 0.95).toFixed(3)})`
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
          break
        case 'gold':
          p.vy += 320 * dt
          ctx.fillStyle = `rgba(255,${Math.round(190 + 55 * alpha)},70,${(alpha * 0.9).toFixed(3)})`
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
          break
        case 'ring': {
          const grow = p.size + (1 - alpha) * 90
          ctx.strokeStyle = `rgba(255,225,160,${(alpha * 0.8).toFixed(3)})`
          ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(p.x, p.y, grow, 0, Math.PI * 2); ctx.stroke()
          break
        }
      }
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,248,230,${(this.flash * 0.55).toFixed(3)})`
      ctx.fillRect(0, 0, w, h)
      this.flash = Math.max(0, this.flash - dt * 1.6)
    }
    if (!this.particles.length && !this.rows.length && this.flash <= 0) this.stop()
  }

  private spawnAmbient(dt: number) {
    if (!this.rows.length) return
    for (const row of this.rows) {
      const rect = row.el.getBoundingClientRect()
      if (!rect.width || rect.bottom < 0 || rect.top > window.innerHeight) continue
      const rate = row.kind === 'rain' ? 34 : row.kind === 'snow' ? 9 : 1.4
      this.spawnAcc[row.kind] += rate * dt
      while (this.spawnAcc[row.kind] >= 1) {
        this.spawnAcc[row.kind] -= 1
        const x = rect.left + Math.random() * rect.width
        if (row.kind === 'rain') this.spawn('rain', x, rect.top - 4, -60, 620, 0.7 + Math.random() * 0.3, 10 + Math.random() * 8)
        else if (row.kind === 'snow') this.spawn('snow', x, rect.top - 6, 4 + Math.random() * 10, 12 + Math.random() * 14, 3.5 + Math.random() * 2, 1.2 + Math.random() * 2)
        else this.spawn('fog', x, rect.top + Math.random() * rect.height, 6 + Math.random() * 14, -2, 4 + Math.random() * 3, 26 + Math.random() * 46)
      }
    }
  }
}
