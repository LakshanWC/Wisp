import React from "react"
import { motion } from "framer-motion"

export function SpinnerIcon({
  size = 12,
  color,
}: {
  size?: number
  color?: string
}) {

  const id = React.useId().replace(/:/g, "")
  const gradId = `wisp-fire-${id}`

  const stroke = color ?? `url(#${gradId})`

  return (
    <motion.span
      style={{ display: "inline-flex", flexShrink: 0, transformOrigin: "50% 50%" }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ transformOrigin: "50% 50%", overflow: "visible" }}
        animate={{ opacity: [0.75, 1, 0.85, 1, 0.8] }}
        transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }}
      >
        {!color && (
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#ffd27a" />
              <stop offset="45%"  stopColor="#ff8a3d" />
              <stop offset="100%" stopColor="#c53b1e" />
            </linearGradient>
          </defs>
        )}

        {/* Four arcs, ~70° each, with ~20° gaps. Radius 9, centered at (12,12). */}
        <g stroke={stroke} strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M 15.08 3.61 A 9 9 0 0 1 21 12" />
          <path d="M 21 12 A 9 9 0 0 1 15.08 20.39" />
          <path d="M 8.92 20.39 A 9 9 0 0 1 3 12" />
          <path d="M 3 12 A 9 9 0 0 1 8.92 3.61" />
        </g>
      </motion.svg>
    </motion.span>
  )
}