import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type AudioPreferences = {
  music: boolean
  effects: boolean
  musicVolume: number
  effectsVolume: number
}
const initial = (): AudioPreferences => {
  let saved: Partial<AudioPreferences> = {}
  let legacyEffects = true
  try {
    const parsed = JSON.parse(localStorage.getItem('gwent-audio') || '{}')
    if (parsed && typeof parsed === 'object') saved = parsed
    legacyEffects = localStorage.getItem('gwent-sound') !== 'off'
  } catch {
    /* Defaults. */
  }
  const volume = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
  return {
    music: typeof saved.music === 'boolean' ? saved.music : legacyEffects,
    effects: typeof saved.effects === 'boolean' ? saved.effects : legacyEffects,
    musicVolume: volume(saved.musicVolume, 0.22),
    effectsVolume: volume(saved.effectsVolume, 0.35),
  }
}
type AudioState = {
  preferences: AudioPreferences
  update: (patch: Partial<AudioPreferences>) => void
  playEffect: (name: string) => void
  resumeMusic: () => void
  musicBlocked: boolean
}
const Context = createContext<AudioState | null>(null)
export function AudioProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(initial),
    [musicBlocked, setMusicBlocked] = useState(false)
  const current = useRef(preferences),
    music = useRef<HTMLAudioElement>(null),
    effects = useRef(new Set<HTMLAudioElement>())
  const graph = useRef<{ context: AudioContext; music: GainNode; effects: GainNode } | null>(null)
  const interacted = useRef(false)
  const audioGraph = useCallback(() => {
    // Gain nodes also control volume on iPad, where media-element volume can
    // remain tied to the hardware buttons.
    if (!graph.current && music.current && window.AudioContext) {
      try {
        const context = new AudioContext(),
          musicGain = context.createGain(),
          effectsGain = context.createGain()
        musicGain.gain.value = current.current.musicVolume
        effectsGain.gain.value = current.current.effectsVolume
        context
          .createMediaElementSource(music.current)
          .connect(musicGain)
          .connect(context.destination)
        effectsGain.connect(context.destination)
        graph.current = { context, music: musicGain, effects: effectsGain }
        music.current.volume = 1
      } catch {
        /* Native playback is the fallback for older browsers. */
      }
    }
    if (
      graph.current &&
      graph.current.context.state !== 'running' &&
      graph.current.context.state !== 'closed'
    )
      void graph.current.context.resume().catch(() => {})
    return graph.current
  }, [])
  const resumeMusic = useCallback(() => {
    interacted.current = true
    const audio = music.current
    if (!audio || !current.current.music || document.hidden) return
    audio.volume = audioGraph() ? 1 : current.current.musicVolume
    if (!audio.paused) return
    void audio
      .play()
      .then(() => setMusicBlocked(false))
      .catch(() => setMusicBlocked(true))
  }, [audioGraph])
  const update = useCallback(
    (patch: Partial<AudioPreferences>) => {
      const next = { ...current.current, ...patch }
      current.current = next
      setPreferences(next)
      try {
        localStorage.setItem('gwent-audio', JSON.stringify(next))
      } catch {
        /* Session still works. */
      }
      if (music.current) {
        music.current.volume = graph.current ? 1 : next.musicVolume
        if (!next.music) music.current.pause()
        else resumeMusic() // Remains inside the user's click on iPad/Safari.
      }
      if (graph.current) {
        graph.current.music.gain.value = next.musicVolume
        graph.current.effects.gain.value = next.effectsVolume
      }
      for (const effect of effects.current) {
        effect.volume = graph.current ? 1 : next.effectsVolume
        if (!next.effects) effect.pause()
      }
      if (!next.effects) effects.current.clear()
    },
    [resumeMusic],
  )
  const playEffect = useCallback(
    (name: string) => {
      if (
        !interacted.current ||
        !current.current.effects ||
        !current.current.effectsVolume ||
        document.hidden
      )
        return
      const audio = new Audio(`/sfx/${name}.mp3`),
        mixer = audioGraph()
      const source = mixer?.context.createMediaElementSource(audio)
      source?.connect(mixer!.effects)
      audio.volume = mixer ? 1 : current.current.effectsVolume
      effects.current.add(audio)
      const forget = () => {
        source?.disconnect()
        effects.current.delete(audio)
      }
      audio.onended = forget
      audio.onpause = forget
      audio.onerror = forget
      void audio.play().catch(forget)
    },
    [audioGraph],
  )
  useEffect(() => {
    const pause = () => {
      music.current?.pause()
      for (const audio of effects.current) audio.pause()
      effects.current.clear()
      if (graph.current) void graph.current.context.suspend().catch(() => {})
    }
    const visibility = () => {
      if (document.hidden) pause()
      else if (interacted.current) resumeMusic()
    }
    const leavePage = (event: PageTransitionEvent) => {
      pause()
      if (!event.persisted) {
        // Release the streaming request and audio device on reload/navigation.
        music.current?.removeAttribute('src')
        music.current?.load()
        if (graph.current) void graph.current.context.close().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', leavePage)
    const soundtrack = music.current,
      playing = effects.current
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', leavePage)
      soundtrack?.pause()
      for (const audio of playing) audio.pause()
      playing.clear()
      if (graph.current) void graph.current.context.close().catch(() => {})
    }
  }, [resumeMusic])
  return (
    <Context.Provider value={{ preferences, update, playEffect, resumeMusic, musicBlocked }}>
      <audio ref={music} data-background-music src="/sfx/music/tavern.mp3" loop preload="none" />
      <div
        style={{ display: 'contents' }}
        onPointerUpCapture={resumeMusic}
        onKeyDownCapture={resumeMusic}
      >
        {children}
      </div>
    </Context.Provider>
  )
}
export function useAudio() {
  const context = useContext(Context)
  if (!context) throw new Error('AudioProvider is required')
  return context
}
export function AudioSettings() {
  const { preferences, update, playEffect, resumeMusic, musicBlocked } = useAudio()
  return (
    <section className="audio-settings" aria-label="Настройки звука">
      <h3>Музыка и звуки</h3>
      {(['music', 'effects'] as const).map((channel) => {
        const key = channel === 'music' ? 'musicVolume' : 'effectsVolume'
        const title = channel === 'music' ? 'Музыка' : 'Звуковые эффекты'
        const label = channel === 'music' ? 'Громкость музыки' : 'Громкость эффектов'
        return (
          <div className="audio-channel" key={channel}>
            <label className="audio-channel-toggle">
              <span>{title}</span>
              <input
                type="checkbox"
                role="switch"
                checked={preferences[channel]}
                onChange={(e) => update({ [channel]: e.target.checked })}
              />
            </label>
            <label className="audio-volume">
              <span>{label}</span>
              <output>{Math.round(preferences[key] * 100)}%</output>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label={label}
                disabled={!preferences[channel]}
                value={Math.round(preferences[key] * 100)}
                onChange={(e) => update({ [key]: Number(e.target.value) / 100 })}
              />
            </label>
          </div>
        )
      })}
      {preferences.music && musicBlocked && (
        <button className="button quiet" onClick={resumeMusic}>
          Запустить музыку
        </button>
      )}
      <button
        className="text-button"
        disabled={!preferences.effects}
        onClick={() => playEffect('ui_card')}
      >
        Проверить звуки
      </button>
    </section>
  )
}
