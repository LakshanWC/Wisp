import { useEffect, useRef } from "react"
import styles from "intro/wisp-intro.module.css"

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
}

type Props = {
  onReady?: () => void
}

export default function WispIntro({ onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const logoRef = useRef<HTMLHeadingElement>(null)
  const subRef = useRef<HTMLParagraphElement>(null)
  const bootRef = useRef<HTMLUListElement>(null)
  const replayRef = useRef<HTMLButtonElement>(null)

  // Keep latest onReady in a ref so the effect doesn't need to re-run
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    const logo = logoRef.current!
    const sub = subRef.current!
    const boot = bootRef.current!
    const replayBtn = replayRef.current!
    const letters = [...logo.querySelectorAll<HTMLSpanElement>("span")]

    const BOOT_LINES = [
      "> WAKING ARCHIVE UNIT",
      "> CHECKING POWER CORE ........",
      "> MOUNTING MEMORY BANKS ......",
      "> ARCHIVE ONLINE. WELCOME BACK."
    ]
    const BOOT_START_MS = 3400
    const LINE_GAP_MS = 520

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    let W = 0
    let H = 0
    let dpr = 1
    let anchors: { x: number; y: number }[] = []
    let particles: Particle[] = []
    let startTime = 0
    let timers: ReturnType<typeof setTimeout>[] = []
    let lit = 0
    let rafId = 0
    let done = false
    let cancelled = false

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      measure()
    }

    function measure() {
      anchors = letters.map(l => {
        const r = l.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })
    }

    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t

    function orbPos(t: number) {
      const first = anchors[0]
      const last = anchors[anchors.length - 1]
      const hoverY = first.y - 90

      if (t < 2) {
        const k = ease(t / 2)
        return {
          x: lerp(-60, first.x, k),
          y: lerp(H * 0.85, hoverY, k) + Math.sin(k * Math.PI * 3) * 40 * (1 - k)
        }
      }
      if (t < 3.4) {
        const k = ease((t - 2) / 1.4)
        return {
          x: lerp(first.x, last.x, k),
          y: hoverY + Math.sin(k * Math.PI * 4) * 18
        }
      }
      const cx = (first.x + last.x) / 2
      const k = ease(Math.min((t - 3.4) / 0.8, 1))
      return {
        x: lerp(last.x, cx, k) + Math.sin(t * 1.3) * 8 * k,
        y: lerp(hoverY, hoverY - 30, k) + Math.sin(t * 2.2) * 6
      }
    }

    function spawn(p: { x: number; y: number }, n: number) {
      for (let i = 0; i < n; i++) {
        particles.push({
          x: p.x + (Math.random() - 0.5) * 10,
          y: p.y + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 0.9,
          vy: -0.3 - Math.random() * 1.3,
          life: 0,
          max: 40 + Math.random() * 45,
          size: 3 + Math.random() * 8
        })
      }
      if (particles.length > 700) particles.splice(0, particles.length - 700)
    }

    function glow(x: number, y: number, r: number, stops: [number, string][]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      stops.forEach(([o, c]) => g.addColorStop(o, c))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    function frame(now: number) {
      if (cancelled) return
      const t = (now - startTime) / 1000
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = "lighter"

      const p = orbPos(t)
      spawn(p, 5)

      // embers
      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i]
        q.x += q.vx
        q.y += q.vy
        q.vx += (Math.random() - 0.5) * 0.12
        q.life++
        const k = q.life / q.max
        if (k >= 1) {
          particles.splice(i, 1)
          continue
        }
        const hue = 210 + 50 * k
        const a = (1 - k) * 0.55
        glow(q.x, q.y, q.size * (1 - k * 0.6), [
          [0, `hsla(${hue}, 100%, 60%, ${a})`],
          [1, `hsla(${hue}, 100%, 50%, 0)`]
        ])
      }

      // halo + core
      glow(p.x, p.y, 95, [
        [0, "rgba(20,110,255,0.22)"],
        [1, "rgba(0,60,255,0)"]
      ])
      const r = 22 + Math.sin(t * 30) * 2 + Math.random() * 2
      glow(p.x, p.y, r, [
        [0, "rgba(220,245,255,1)"],
        [0.25, "rgba(90,200,255,0.95)"],
        [0.6, "rgba(20,100,255,0.4)"],
        [1, "rgba(0,60,255,0)"]
      ])

      ctx.globalCompositeOperation = "source-over"

      // ignite letters as the orb passes over them (only once the sweep begins)
      if (t >= 2) {
        while (lit < letters.length && p.x >= anchors[lit].x - 6) {
          letters[lit].classList.add(styles.lit)
          lit++
        }
      }
      if (t >= 3.2) sub.classList.add(styles.show)

      rafId = requestAnimationFrame(frame)
    }

    function addLine(text: string, cls?: string) {
      const li = document.createElement("li")
      li.textContent = text
      if (cls) li.className = cls
      boot.appendChild(li)
      return li
    }

    function runBoot(instant: boolean) {
      BOOT_LINES.forEach((text, i) => {
        const show = () => {
          const li = addLine(text)
          const ok = document.createElement("span")
          ok.className = styles.ok
          ok.textContent = "[ OK ]"
          if (instant) li.appendChild(ok)
          else timers.push(setTimeout(() => li.appendChild(ok), 260))
        }
        if (instant) show()
        else timers.push(setTimeout(show, BOOT_START_MS + i * LINE_GAP_MS))
      })

      const finish = () => {
        if (done) return
        done = true
        addLine("> READY", styles.final)
        replayBtn.classList.add(styles.show)
        document.dispatchEvent(new CustomEvent("wisp:ready"))
        onReadyRef.current?.()
      }
      if (instant) finish()
      else timers.push(setTimeout(finish, BOOT_START_MS + BOOT_LINES.length * LINE_GAP_MS + 300))
    }

    function start() {
      timers.forEach(clearTimeout)
      timers = []
      particles = []
      lit = 0
      done = false
      boot.innerHTML = ""
      letters.forEach(l => l.classList.remove(styles.lit))
      sub.classList.remove(styles.show)
      replayBtn.classList.remove(styles.show)
      measure()

      if (reduceMotion) {
        startTime = performance.now() - 10000
        letters.forEach(l => l.classList.add(styles.lit))
        sub.classList.add(styles.show)
        runBoot(true)
        return
      }
      startTime = performance.now()
      runBoot(false)
    }

    const onResize = () => resize()
    const onReplay = () => start()
    window.addEventListener("resize", onResize)
    replayBtn.addEventListener("click", onReplay)

    const go = () => {
      if (cancelled) return
      resize()
      start()
      rafId = requestAnimationFrame(frame)
    }

    // wait for fonts so letter positions are measured correctly
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go)
    else window.addEventListener("load", go)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      timers.forEach(clearTimeout)
      timers = []
      window.removeEventListener("resize", onResize)
      replayBtn.removeEventListener("click", onReplay)
      window.removeEventListener("load", go)
    }
  }, [])

  return (
    <div className={styles.root}>
      <div className={styles.scan} aria-hidden="true" />
      <canvas ref={canvasRef} className={styles.fx} aria-hidden="true" />
      <main className={styles.stage}>
        <h1 className={styles.logo} aria-label="WISP" ref={logoRef}>
          <span aria-hidden="true">W</span>
          <span aria-hidden="true">I</span>
          <span aria-hidden="true">S</span>
          <span aria-hidden="true">P</span>
        </h1>
        <p className={styles.sub} ref={subRef}>// ARCHIVE UNIT</p>
        <ul className={styles.boot} ref={bootRef} />
      </main>
      <button
        ref={replayRef}
        className={styles.replay}
        type="button"
        aria-label="Replay intro"
      >
        ↻ REPLAY
      </button>
    </div>
  )
}