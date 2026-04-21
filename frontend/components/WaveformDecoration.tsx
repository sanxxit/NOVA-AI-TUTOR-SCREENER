'use client';

interface Props {
  bars?: number;
  maxHeight?: number;
  minHeight?: number;
  period?: number;   // ms — full animation cycle
  color?: string;
  opacity?: number;
  className?: string;
}

// Decorative animated waveform — signals "this is a voice conversation".
// Each bar has a unique phase offset so the crest travels left → right.
export default function WaveformDecoration({
  bars = 40,
  maxHeight = 30,
  minHeight = 4,
  period = 2400,
  color = '#2563EB',
  opacity = 0.5,
  className = '',
}: Props) {
  return (
    <div className={`flex items-center justify-center gap-[3px] ${className}`}>
      {Array.from({ length: bars }).map((_, i) => {
        const t = i / (bars - 1); // 0 → 1
        // Sine-wave envelope gives naturally varying bar heights
        const h = minHeight + Math.abs(Math.sin(t * Math.PI * 3.2 + 0.6)) * (maxHeight - minHeight);
        // Negative delay = bar starts already mid-cycle → wave travels continuously
        const delay = -((i / bars) * period);
        return (
          <div
            key={i}
            style={{
              width: '3px',
              height: `${h}px`,
              backgroundColor: color,
              borderRadius: '99px',
              opacity,
              transformOrigin: 'center',
              animation: `waveformBreathe ${period}ms ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
