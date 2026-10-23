import { ArrowUpRight, FolderOpen } from 'lucide-react'
import { sourceImageUrl } from '../api/images'
import type { ProjectSummary } from '../api/types'
import { formatDate } from '../lib/format'

interface RecentProjectsProps {
  projects: ProjectSummary[]
}

export function RecentProjects({ projects }: RecentProjectsProps) {
  return (
    <section className="rounded-[2px] border border-line bg-surface p-4 shadow-sheet sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="display text-xl font-semibold tracking-tight">
          Recent projects
        </h2>
        <span className="font-mono text-[10px] text-muted">
          {projects.length}
        </span>
      </div>

      <ul className="mt-4 max-h-[13.5rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {projects.map((project) => (
          <li key={project.id}>
            <a
              href={`?project=${encodeURIComponent(project.id)}`}
              className="group flex items-center gap-3 rounded-[2px] border border-line bg-surface-2/35 px-2.5 py-2 transition-colors hover:border-pine/40 hover:bg-pine-soft/40"
            >
              <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-[2px] border border-line bg-surface-3 text-muted">
                {project.cover_image_id !== null ? (
                  <img
                    src={sourceImageUrl(project.cover_image_id)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <FolderOpen className="size-4" aria-hidden="true" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {project.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {project.image_count === 0
                    ? 'No photos yet'
                    : `${project.image_count} ${
                        project.image_count === 1 ? 'photo' : 'photos'
                      }`}{' '}
                  · {formatDate(project.updated_at)}
                </span>
              </span>

              <ArrowUpRight
                className="size-4 shrink-0 text-muted transition-colors group-hover:text-pine"
                aria-hidden="true"
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
