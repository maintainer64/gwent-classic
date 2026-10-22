import { RoomStatus, type Room } from '../domain/types'
import './TurnTimer.css'

// Monotonic UI countdown: serverTime avoids device clock skew at receipt.
// Neither this component nor browser storage can authorize a move after timeout.
export class TurnTimer {
  private readonly root = document.createElement('div')
  private readonly label = document.createElement('span')
  private readonly clock = document.createElement('strong')
  private readonly progress = document.createElement('div')
  private deadlineAt = 0
  private sampledAt = 0
  private initialRemaining = 0
  constructor(host: HTMLElement) {
    this.root.id = 'classic-turn-clock'
    this.root.setAttribute('role', 'timer')
    this.root.setAttribute('aria-label', 'Время на ход')
    const track = document.createElement('div')
    track.className = 'classic-turn-track'
    track.append(this.progress)
    this.progress.className = 'classic-turn-progress'
    this.label.className = 'classic-turn-label'
    this.root.append(this.label, this.clock, track)
    host.append(this.root)
    this.root.hidden = true
    window.setInterval(() => this.tick(), 250)
  }
  update(room: Room) {
    const available = room.status === RoomStatus.Playing &&
      room.phase === 'turn' && !room.initiative && Boolean(room.turnDeadline)
    if (!available) {
      this.root.hidden = true
      this.deadlineAt = 0
      return
    }
    const deadline = Date.parse(room.turnDeadline!)
    const sourceTime = Date.parse(room.serverTime)
    if (!Number.isFinite(deadline) || !Number.isFinite(sourceTime)) {
      this.root.hidden = true
      return
    }
    this.root.hidden = false
    this.label.textContent = room.turn === room.seat ? 'Ваш ход' : 'Ход противника'
    this.sampledAt = performance.now()
    this.initialRemaining = Math.max(0,deadline-sourceTime)
    this.deadlineAt = deadline
    this.tick()
  }
  private tick() {
    if (this.root.hidden || !this.deadlineAt) return
    const remain = Math.max(0,this.initialRemaining - (performance.now()-this.sampledAt))
    const seconds = Math.ceil(remain / 1000)
    const minutes = Math.floor(seconds / 60)
    this.clock.textContent = `${String(minutes).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`
    this.progress.style.width = `${Math.min(100, remain / Math.max(this.initialRemaining, 1) * 100)}%`
    this.root.classList.toggle('classic-turn-urgent',seconds<=10)
    this.root.classList.toggle('classic-turn-over',seconds===0)
  }
}
