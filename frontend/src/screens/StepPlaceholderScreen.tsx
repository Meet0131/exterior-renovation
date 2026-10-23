import type { ReactNode } from 'react'
import {
  Calculator,
  FileText,
  Image as ImageIcon,
  Paintbrush,
  PenLine,
} from 'lucide-react'
import type { Step } from '../lib/steps'
import { STEPS, stepLabel } from '../lib/steps'
import { formatDate } from '../lib/format'
import { useWorkspace } from '../state/useWorkspace'
import { EmptyState } from '../components/ui/EmptyState'
import type { FinalPreviewStatus } from '../state/WorkspaceContext'

const STEP_COPY: Record<
  Step,
  { title: string; description: string; icon: ReactNode }
> = {
  upload: {
    title: 'Upload',
    description: 'One straight-on facade photo starts the project.',
    icon: <ImageIcon className="size-5" strokeWidth={1.8} />,
  },
  regions: {
    title: 'Mark regions',
    description:
      'Draw the surfaces, openings and reference outlines, then set the scale.',
    icon: <PenLine className="size-5" strokeWidth={1.8} />,
  },
  materials: {
    title: 'Materials',
    description:
      'Choose a material and colour for every costed surface and compare the result.',
    icon: <Paintbrush className="size-5" strokeWidth={1.8} />,
  },
  estimate: {
    title: 'Estimate',
    description:
      'Review measured quantities, editable rates and the contingency.',
    icon: <Calculator className="size-5" strokeWidth={1.8} />,
  },
  report: {
    title: 'Report',
    description:
      'Review the stored final image and download the estimation PDF.',
    icon: <FileText className="size-5" strokeWidth={1.8} />,
  },
}

const FINAL_PREVIEW_LABELS: Record<FinalPreviewStatus, string> = {
  unknown: 'Not checked',
  checking: 'Checking…',
  fresh: 'Ready',
  absent: 'Not rendered yet',
  'missing-image': 'Photo unavailable',
  error: 'Could not check',
}

function SnapshotRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink-2">{value}</dd>
    </div>
  )
}

export function StepPlaceholderScreen({ step }: { step: Step }) {
  const {
    project,
    activeImage,
    materials,
    materialsLoading,
    regions,
    finalPreviewStatus,
  } = useWorkspace()

  if (project === null) return null

  const copy = STEP_COPY[step]
  const index = STEPS.findIndex((item) => item.id === step)
  const finishes = regions.filter(
    (region) => region.region_role === 'finish',
  )
  const assignedFinishes = finishes.filter(
    (region) => region.material_id !== null,
  ).length

  return (
    <div className="screen-enter">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-measure">
            Step {index + 1} of {STEPS.length}
          </p>
          <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
            {stepLabel(step)}
          </h1>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted">
            {copy.description}
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
          Workspace ready
        </span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.52fr)]">
        <EmptyState
          icon={copy.icon}
          title={`The ${copy.title.toLowerCase()} screen is next.`}
          description="The project link, workspace state and step checks are in place. This screen will fill in as the next build step lands."
        />

        <section className="rounded-[2px] border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display text-lg font-semibold tracking-tight">
              Project snapshot
            </h2>
            <span className="font-mono text-[10px] text-muted">
              {formatDate(project.updated_at)}
            </span>
          </div>

          <dl className="mt-3 divide-y divide-line">
            <SnapshotRow label="Project" value={project.title} />
            <SnapshotRow
              label="Photo"
              value={
                activeImage === null
                  ? 'Not added yet'
                  : `${activeImage.width} × ${activeImage.height} px`
              }
            />
            <SnapshotRow
              label="Regions"
              value={
                regions.length === 0
                  ? 'None yet'
                  : `${regions.length} marked`
              }
            />
            <SnapshotRow
              label="Surfaces assigned"
              value={
                finishes.length === 0
                  ? 'None yet'
                  : `${assignedFinishes} of ${finishes.length} assigned`
              }
            />
            <SnapshotRow
              label="Final image"
              value={FINAL_PREVIEW_LABELS[finalPreviewStatus]}
            />
            <SnapshotRow
              label="Materials"
              value={
                materialsLoading
                  ? 'Loading…'
                  : `${materials.length} in catalog`
              }
            />
            <SnapshotRow
              label="Project link"
              value="Saved in the address bar"
            />
          </dl>
        </section>
      </div>
    </div>
  )
}
