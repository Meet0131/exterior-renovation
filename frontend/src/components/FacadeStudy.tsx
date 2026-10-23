export function FacadeStudy() {
  const railingPosts = Array.from({ length: 11 }, (_, index) => 192 + index * 25)

  return (
    <figure className="facade-study relative mx-auto w-full max-w-[560px]">
      <div className="rounded-[2px] border border-line bg-surface p-3 shadow-sheet lg:rotate-[0.8deg] sm:p-4">
        <svg
          viewBox="0 0 640 760"
          role="img"
          aria-labelledby="facade-title facade-description"
          className="h-auto w-full"
        >
          <title id="facade-title">Facade elevation study</title>
          <desc id="facade-description">
            A measured elevation drawing of a two-storey house with a balcony,
            dimension lines and material swatches.
          </desc>

          <defs>
            <pattern
              id="study-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M24 0H0V24"
                fill="none"
                stroke="var(--color-line)"
                strokeWidth="0.6"
              />
            </pattern>
          </defs>

          <rect width="640" height="760" fill="var(--color-surface)" />
          <rect
            width="640"
            height="760"
            fill="url(#study-grid)"
            opacity="0.55"
          />

          <g
            stroke="var(--color-line-strong)"
            strokeWidth="1"
            fill="none"
            aria-hidden="true"
          >
            <path d="M28 20v16M20 28h16" />
            <path d="M612 20v16M604 28h16" />
            <path d="M28 724v16M20 732h16" />
            <path d="M612 724v16M604 732h16" />
          </g>

          <text
            x="44"
            y="54"
            fill="var(--color-ink)"
            fontFamily="var(--font-display)"
            fontSize="20"
            fontWeight="700"
            letterSpacing="-0.4"
          >
            Elevation study
          </text>
          <text
            x="44"
            y="75"
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
            fontSize="10"
          >
            One facade, five steps
          </text>
          <text
            x="596"
            y="54"
            textAnchor="end"
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
            fontSize="10"
          >
            Sheet 01
          </text>

          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            <path
              d="M70 620H570"
              stroke="var(--color-ink)"
              strokeWidth="2"
            />
            <rect
              x="150"
              y="252"
              width="340"
              height="368"
              fill="var(--color-surface)"
              stroke="var(--color-ink)"
              strokeWidth="2"
            />
            <path
              d="M128 252 320 150 512 252"
              stroke="var(--color-pine)"
              strokeWidth="3"
            />
            <path
              d="M150 252 320 164 490 252"
              stroke="var(--color-pine)"
              strokeWidth="1"
              opacity="0.45"
            />

            <rect
              x="196"
              y="308"
              width="78"
              height="94"
              fill="var(--color-measure-soft)"
              stroke="var(--color-measure)"
              strokeWidth="2"
            />
            <path
              d="M235 308v94M196 355h78"
              stroke="var(--color-measure)"
              strokeWidth="1"
              opacity="0.7"
            />
            <rect
              x="366"
              y="308"
              width="78"
              height="94"
              fill="var(--color-measure-soft)"
              stroke="var(--color-measure)"
              strokeWidth="2"
            />
            <path
              d="M405 308v94M366 355h78"
              stroke="var(--color-measure)"
              strokeWidth="1"
              opacity="0.7"
            />

            <rect
              x="285"
              y="385"
              width="70"
              height="57"
              fill="var(--color-pine-soft)"
              stroke="var(--color-pine)"
              strokeWidth="2"
            />
            <path
              d="M320 385v57"
              stroke="var(--color-pine)"
              strokeWidth="1"
              opacity="0.7"
            />

            <path
              d="M168 442H472"
              stroke="var(--color-ink)"
              strokeWidth="4"
            />
            <path
              d="M188 400H452"
              stroke="var(--color-amber)"
              strokeWidth="1.5"
            />
            {railingPosts.map((x) => (
              <path
                key={x}
                d={`M${x} 400V442`}
                stroke="var(--color-amber)"
                strokeWidth="1.2"
              />
            ))}

            <rect
              x="195"
              y="470"
              width="64"
              height="78"
              fill="var(--color-measure-soft)"
              stroke="var(--color-measure)"
              strokeWidth="2"
            />
            <path
              d="M227 470v78M195 509h64"
              stroke="var(--color-measure)"
              strokeWidth="1"
              opacity="0.7"
            />
            <rect
              x="381"
              y="470"
              width="64"
              height="78"
              fill="var(--color-measure-soft)"
              stroke="var(--color-measure)"
              strokeWidth="2"
            />
            <path
              d="M413 470v78M381 509h64"
              stroke="var(--color-measure)"
              strokeWidth="1"
              opacity="0.7"
            />

            <rect
              x="285"
              y="500"
              width="70"
              height="120"
              fill="var(--color-pine-soft)"
              stroke="var(--color-pine)"
              strokeWidth="2"
            />
            <circle
              cx="342"
              cy="562"
              r="2.5"
              fill="var(--color-pine)"
              stroke="none"
            />
            <path
              d="M270 620h100"
              stroke="var(--color-ink)"
              strokeWidth="5"
            />
            <path
              d="M282 634h76"
              stroke="var(--color-line-strong)"
              strokeWidth="2"
            />
          </g>

          <g fill="none" stroke="var(--color-measure)" strokeWidth="1.2">
            <path d="M104 252v368" strokeDasharray="4 4" />
            <path d="M98 252h12M98 620h12" />
            <path d="M100 260l4 8 4-8M100 612l4-8 4 8" />
          </g>
          <text
            x="84"
            y="436"
            transform="rotate(-90 84 436)"
            textAnchor="middle"
            fill="var(--color-measure)"
            fontFamily="var(--font-mono)"
            fontSize="10"
          >
            known length
          </text>

          <g fill="none" stroke="var(--color-measure)" strokeWidth="1.1">
            <path d="M150 658h340" strokeDasharray="3 5" />
            <path d="M150 652v12M490 652v12" />
            <path d="M158 656l8 4-8 4M482 656l-8 4 8 4" />
          </g>
          <text
            x="320"
            y="680"
            textAnchor="middle"
            fill="var(--color-measure)"
            fontFamily="var(--font-mono)"
            fontSize="10"
          >
            one measured line sets the scale
          </text>

          <text
            x="150"
            y="706"
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
            fontSize="9"
          >
            Finish study
          </text>
          <g>
            {[
              'var(--color-pine-soft)',
              'var(--color-amber-soft)',
              'var(--color-surface-3)',
              '#C9B79C',
              '#8B5E3C',
            ].map((fill, index) => (
              <rect
                key={fill}
                x={150 + index * 44}
                y="714"
                width="36"
                height="30"
                rx="2"
                fill={fill}
                stroke="var(--color-line-strong)"
                strokeWidth="0.8"
              />
            ))}
          </g>
        </svg>
      </div>
      <figcaption className="mt-3 flex items-center justify-between gap-4 px-1 text-xs text-muted">
        <span>Made for one facade photo</span>
        <span className="font-mono">advisory plan</span>
      </figcaption>
    </figure>
  )
}
