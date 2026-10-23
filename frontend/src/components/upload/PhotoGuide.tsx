import { Check, Crop, ScanLine, ShieldCheck, Sun } from 'lucide-react'

const PHOTO_TIPS = [
  {
    icon: ScanLine,
    title: 'Straight on',
    body: 'Stand square to the facade. A corner angle stretches every measurement.',
  },
  {
    icon: Sun,
    title: 'Even daylight',
    body: 'Overcast light or open shade. Hard sun and glare hide the edges.',
  },
  {
    icon: Crop,
    title: 'The whole facade',
    body: 'Keep the roof line and the ground in frame, with a little air around them.',
  },
]

function FacadeFrameDiagram() {
  return (
    <svg
      viewBox="0 0 320 180"
      className="block h-auto w-full"
      role="img"
      aria-labelledby="photo-frame-title"
    >
      <title id="photo-frame-title">
        A straight-on facade inside a framing rectangle, with a height
        dimension and a sun.
      </title>

      <rect
        x="18"
        y="14"
        width="284"
        height="152"
        rx="2"
        className="fill-none stroke-line"
        strokeDasharray="5 6"
      />
      <path
        d="M94 138V88l66-36 66 36v50"
        className="fill-none stroke-line-strong"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M86 138h148"
        className="stroke-line-strong"
        strokeWidth="1.5"
      />
      <rect
        x="112"
        y="102"
        width="24"
        height="36"
        className="fill-paper stroke-line-strong"
        strokeWidth="1.2"
      />
      <rect
        x="184"
        y="102"
        width="24"
        height="36"
        className="fill-paper stroke-line-strong"
        strokeWidth="1.2"
      />
      <rect
        x="148"
        y="116"
        width="24"
        height="22"
        className="fill-paper stroke-line-strong"
        strokeWidth="1.2"
      />
      <path
        d="M160 88v50"
        className="stroke-measure"
        strokeDasharray="2 4"
      />
      <g className="stroke-measure" strokeWidth="1">
        <path d="M70 88v50M66 88h8M66 138h8" />
        <path d="M70 88h16M70 138h16" strokeDasharray="2 3" />
      </g>
      <text
        x="52"
        y="113"
        transform="rotate(-90 52 113)"
        className="fill-measure font-mono text-[8px]"
      >
        height
      </text>
      <circle
        cx="256"
        cy="44"
        r="10"
        className="fill-amber-soft stroke-amber"
        strokeWidth="1.2"
      />
      <g className="stroke-amber" strokeWidth="1">
        <path d="M256 26v-6M256 68v-6M238 44h-6M280 44h-6M243 31l-4-4M273 61l-4-4M269 31l4-4M243 57l-4 4" />
      </g>
    </svg>
  )
}

export function PhotoGuide() {
  return (
    <div className="space-y-5">
      <section
        aria-labelledby="photo-guide-heading"
        className="rounded-[2px] border border-line bg-surface p-5 shadow-sheet"
      >
        <h2
          id="photo-guide-heading"
          className="display text-lg font-semibold tracking-tight"
        >
          A photo you can measure from.
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-muted">
          The next steps measure the facade from this photo.
        </p>

        <div className="mt-4 overflow-hidden rounded-[2px] border border-line bg-surface-2/60 p-2">
          <FacadeFrameDiagram />
        </div>

        <ul className="mt-5 space-y-4">
          {PHOTO_TIPS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-pine-soft text-pine">
                <Icon
                  className="size-4"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-2">{title}</p>
                <p className="mt-0.5 text-sm leading-5 text-muted">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[2px] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-measure-soft text-measure">
            <ShieldCheck
              className="size-4.5"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <h2 className="display text-lg font-semibold tracking-tight">
              What the server checks
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Sharpness and exposure, once the photo arrives.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2 border-t border-line pt-4 text-sm text-ink-2">
          <li className="flex items-start gap-2">
            <Check
              className="mt-0.5 size-4 shrink-0 text-ok"
              strokeWidth={2.2}
              aria-hidden="true"
            />
            <span>Blur, dark photos and glare come back with a plain fix.</span>
          </li>
          <li className="flex items-start gap-2">
            <Check
              className="mt-0.5 size-4 shrink-0 text-ok"
              strokeWidth={2.2}
              aria-hidden="true"
            />
            <span>The stored photo is a web-ready copy.</span>
          </li>
        </ul>

        <p className="mt-3 text-xs leading-5 text-muted">
          It doesn’t judge the view. You decide whether this is your facade.
        </p>
      </section>
    </div>
  )
}
