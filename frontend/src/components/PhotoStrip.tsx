import { useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { sourceImageUrl } from '../api/images'
import { cn } from '../lib/cn'
import { PROJECT_PHOTO_LIMIT, sortProjectImages } from '../lib/photos'
import { useWorkspace } from '../state/useWorkspace'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Spinner } from './ui/Spinner'

export function PhotoStrip() {
  const {
    project,
    activeImage,
    selectImage,
    reorderImages,
    deleteImage,
    navigate,
  } = useWorkspace()
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  if (project === null || project.images.length < 2) return null

  const images = sortProjectImages(project.images)
  const atLimit = images.length >= PROJECT_PHOTO_LIMIT
  const busy = switchingId !== null || mutating

  const deleteTarget = images.find((image) => image.id === deleteTargetId)
  const deleteTargetNumber =
    images.findIndex((image) => image.id === deleteTargetId) + 1

  const handleSelect = async (imageId: string) => {
    if (imageId === activeImage?.id || busy) return
    setSwitchingId(imageId)
    try {
      await selectImage(imageId)
    } finally {
      setSwitchingId(null)
    }
  }

  const handleReorder = async (movedId: string, targetId: string) => {
    if (busy || movedId === targetId) return
    setMutating(true)
    try {
      await reorderImages(movedId, targetId)
    } finally {
      setMutating(false)
    }
  }

  const handleDeleteConfirm = async () => {
    const imageId = deleteTargetId
    setDeleteTargetId(null)
    if (imageId === null || busy) return
    setMutating(true)
    try {
      await deleteImage(imageId)
    } finally {
      setMutating(false)
    }
  }

  return (
    <div className="border-b border-line bg-surface/70">
      <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-2 sm:px-8">
        <span className="shrink-0 text-[11px] font-medium text-muted">
          Photos
        </span>
        <div
          role="group"
          aria-label="Project photos. Drag a photo to reorder."
          className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1"
        >
          {images.map((image, index) => {
            const active = image.id === activeImage?.id
            const switching = image.id === switchingId
            const isDropTarget =
              dropTargetId === image.id && draggingId !== image.id

            return (
              <div key={image.id} className="group relative shrink-0">
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`Show photo ${index + 1}. Drag to reorder, or hold Alt and press an arrow key.`}
                  title="Drag to reorder"
                  draggable={!busy}
                  onClick={() => {
                    void handleSelect(image.id)
                  }}
                  onKeyDown={(event) => {
                    if (!event.altKey) return
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                      return
                    }
                    event.preventDefault()
                    const target = images[index + (event.key === 'ArrowLeft' ? -1 : 1)]
                    if (target) void handleReorder(image.id, target.id)
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', image.id)
                    setDraggingId(image.id)
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setDropTargetId(null)
                  }}
                  onDragOver={(event) => {
                    if (draggingId === null || draggingId === image.id) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTargetId(image.id)
                  }}
                  onDragLeave={() => {
                    setDropTargetId((current) =>
                      current === image.id ? null : current,
                    )
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const movedId =
                      draggingId ?? event.dataTransfer.getData('text/plain')
                    setDraggingId(null)
                    setDropTargetId(null)
                    if (movedId) void handleReorder(movedId, image.id)
                  }}
                  disabled={busy && !switching}
                  className={cn(
                    'flex shrink-0 cursor-grab items-center gap-1.5 rounded-[2px] border p-1 pr-2 transition-colors active:cursor-grabbing disabled:cursor-wait disabled:opacity-70',
                    active
                      ? 'border-pine bg-pine-soft'
                      : 'border-line bg-surface hover:border-line-strong',
                    draggingId === image.id && 'opacity-50',
                    isDropTarget &&
                      'ring-2 ring-pine ring-offset-1 ring-offset-surface',
                  )}
                >
                  <span className="relative block size-8 overflow-hidden rounded-[1px] bg-surface-2">
                    <img
                      src={sourceImageUrl(image.id)}
                      alt=""
                      draggable={false}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {switching ? (
                      <span className="absolute inset-0 grid place-items-center bg-surface/70">
                        <Spinner className="size-3.5 text-pine" />
                      </span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-medium text-ink-2">
                    Photo {index + 1}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  title="Remove photo"
                  disabled={busy}
                  onClick={() => setDeleteTargetId(image.id)}
                  className="absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full border border-line bg-surface text-muted opacity-0 transition-opacity hover:border-danger/50 hover:text-danger focus-visible:opacity-100 disabled:opacity-40 group-focus-within:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-2.5" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden font-mono text-[10px] text-muted sm:inline">
            {images.length} of {PROJECT_PHOTO_LIMIT}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={atLimit}
            title={
              atLimit
                ? `A project can hold ${PROJECT_PHOTO_LIMIT} photos.`
                : undefined
            }
            onClick={() => {
              void navigate('upload')
            }}
            icon={<ImagePlus className="size-3.5" aria-hidden="true" />}
          >
            {atLimit ? 'Photo limit' : 'Add photo'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== undefined}
        title="Remove this photo?"
        description={
          deleteTarget === undefined
            ? ''
            : `Photo ${deleteTargetNumber} and everything marked on it will be removed. This can't be undone.`
        }
        confirmLabel="Remove photo"
        destructive
        onConfirm={() => {
          void handleDeleteConfirm()
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  )
}
