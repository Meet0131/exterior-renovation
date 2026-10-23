import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image as ImageIcon,
  Info,
  Minus,
  MousePointer2,
  Pentagon,
  Ruler,
  Sparkles,
} from 'lucide-react'
import { ApiError, getErrorMessage, isAbortError } from '../api/client'
import { detectRegions } from '../api/images'
import type {
  GeometryPoint,
  GeometryType,
  SurfaceType,
} from '../api/types'
import { CalibrationCard } from '../components/regions/CalibrationCard'
import { NewRegionForm } from '../components/regions/NewRegionForm'
import { RegionCanvas } from '../components/regions/RegionCanvas'
import { RegionInspector } from '../components/regions/RegionInspector'
import { RegionList } from '../components/regions/RegionList'
import { SuggestionTray } from '../components/regions/SuggestionTray'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Spinner } from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import { formatMeasure } from '../lib/format'
import { photoNumber } from '../lib/photos'
import {
  computePointDistance,
  computeScaleFtPerPx,
} from '../lib/geometry'
import type {
  SuggestionReviewItem,
  SurfaceChangeResult,
} from '../lib/regions'
import {
  computeRegionGeometryProblem,
  computeRegionTotals,
  computeSurfaceChange,
  reviewDetectedSuggestion,
} from '../lib/regions'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

const MIN_CALIBRATION_DRAG_PX = 3
const MAX_SUGGESTIONS = 20

type DrawTool = 'select' | 'polygon' | 'line'

function toolButtonClass(active: boolean): string {
  return cn(
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors',
    active
      ? 'bg-pine text-on-pine shadow-sm'
      : 'text-muted hover:bg-surface hover:text-ink',
  )
}

export function RegionsScreen() {
  const {
    project,
    activeImage,
    calibration,
    regions,
    selectedRegionId,
    materials,
    saveErrorInfo,
    selectRegion,
    updateRegion,
    createRegion,
    deleteRegion,
    updateCalibration,
    flushSaves,
    navigate,
    showToast,
  } = useWorkspace()

  const [tool, setTool] = useState<DrawTool>('select')
  const [showToolHint, setShowToolHint] = useState(false)
  const [drawPoints, setDrawPoints] = useState<GeometryPoint[]>([])
  const [drawError, setDrawError] = useState<string | null>(null)
  const [pendingShape, setPendingShape] = useState<{
    geometryType: GeometryType
    points: GeometryPoint[]
  } | null>(null)
  const [surfaceNotice, setSurfaceNotice] = useState<{
    regionId: string
    message: string
  } | null>(null)
  const [calibrationDraft, setCalibrationDraft] = useState<
    GeometryPoint[] | null
  >(null)
  const [deleteRegionId, setDeleteRegionId] = useState<string | null>(
    null,
  )
  const [clearCalibrationOpen, setClearCalibrationOpen] =
    useState(false)
  const [suggestions, setSuggestions] = useState<
    SuggestionReviewItem[]
  >([])
  const [activeSuggestionKey, setActiveSuggestionKey] = useState<
    string | null
  >(null)
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [suggestionError, setSuggestionError] = useState<string | null>(
    null,
  )
  const [suggestionUnavailable, setSuggestionUnavailable] =
    useState(false)
  const [suggestionTruncated, setSuggestionTruncated] = useState(false)
  const [pendingEditKey, setPendingEditKey] = useState<string | null>(
    null,
  )
  const [pendingShapeError, setPendingShapeError] = useState<
    string | null
  >(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const focusListAfterDeleteRef = useRef(false)
  const detectionRequestRef = useRef(0)
  const detectionAbortRef = useRef<AbortController | null>(null)
  const suggestionCounterRef = useRef(0)

  const selectedRegion =
    regions.find((region) => region.id === selectedRegionId) ?? null
  const selectedId = selectedRegion?.id ?? null
  const deleteTarget =
    regions.find((region) => region.id === deleteRegionId) ?? null
  const openings = regions.filter(
    (region) => region.region_role === 'opening',
  )
  const editingSuggestion =
    pendingEditKey === null
      ? null
      : (suggestions.find(
          (suggestion) => suggestion.key === pendingEditKey,
        ) ?? null)
  const traySuggestions = suggestions.filter(
    (suggestion) => suggestion.key !== pendingEditKey,
  )
  const showSuggestionTray =
    suggestionLoading ||
    suggestionError !== null ||
    traySuggestions.length > 0

  const width = activeImage?.width ?? 0
  const height = activeImage?.height ?? 0
  const scaleFtPerPx =
    activeImage === null
      ? null
      : computeScaleFtPerPx(calibration, width, height)
  const totals = computeRegionTotals(
    regions,
    scaleFtPerPx,
    width,
    height,
  )

  const summaryParts: string[] = []
  if (totals.areaCount > 0) {
    summaryParts.push(
      totals.measuredAreaCount > 0 && totals.unmeasuredAreaCount > 0
        ? `${totals.measuredAreaCount} of ${totals.areaCount} areas measured`
        : totals.areaCount === 1
          ? '1 area'
          : `${totals.areaCount} areas`,
    )
  }
  if (totals.areaTotal !== null) {
    summaryParts.push(formatMeasure(totals.areaTotal, 'sqft'))
  } else if (totals.areaCount > 0) {
    summaryParts.push('set a scale')
  }
  if (totals.railingCount > 0) {
    if (totals.railingLength !== null) {
      summaryParts.push(
        totals.unmeasuredRailingCount > 0
          ? `${formatMeasure(totals.railingLength, 'rft')} railing (${totals.unmeasuredRailingCount} unmeasured)`
          : `${formatMeasure(totals.railingLength, 'rft')} railing`,
      )
    } else {
      summaryParts.push('railing not measured')
    }
  }
  const summary =
    summaryParts.length === 0
      ? regions.length === 0
        ? 'No regions yet'
        : `${regions.length} marked`
      : summaryParts.join(' · ')

  const selectedRegionError =
    saveErrorInfo?.resource === 'regions' &&
    selectedRegion !== null &&
    saveErrorInfo.regionId === selectedRegion.id
      ? saveErrorInfo
      : null
  const calibrationError =
    saveErrorInfo?.resource === 'calibration' ? saveErrorInfo : null

  const activeDrawTool =
    tool === 'polygon' || tool === 'line' ? tool : null
  const drawingTool = pendingShape === null ? activeDrawTool : null
  const draftGeometryType = pendingShape?.geometryType ?? activeDrawTool
  const selectActive = tool === 'select' && calibrationDraft === null
  const drawProblem =
    drawingTool === null
      ? null
      : computeRegionGeometryProblem(drawingTool, drawPoints)
  const toolHint =
    calibrationDraft !== null
      ? 'Click two points on something with a known length, then type its real length.'
      : drawingTool === 'polygon'
        ? 'Click points around the surface. Close the shape by tapping the first point or Finish shape.'
        : drawingTool === 'line'
          ? 'Click along the railing, point by point. Tap Finish line when you reach the end.'
          : 'Click a region on the photo to select it. Drag any point to adjust its shape.'

  const beginCalibration = useCallback(() => {
    setPendingShape(null)
    setPendingEditKey(null)
    setPendingShapeError(null)
    setDrawPoints([])
    setDrawError(null)
    setTool('select')
    setShowToolHint(true)
    setCalibrationDraft([])
    window.requestAnimationFrame(() => {
      canvasRef.current?.scrollIntoView({
        behavior: window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
          ? 'auto'
          : 'smooth',
        block: 'center',
      })
      canvasRef.current?.focus({ preventScroll: true })
    })
  }, [])

  const cancelDetection = useCallback(() => {
    detectionRequestRef.current += 1
    detectionAbortRef.current?.abort()
    detectionAbortRef.current = null
    setSuggestionLoading(false)
  }, [])

  const runDetection = useCallback(async () => {
    const image = activeImage
    if (image === null) return

    const requestId = detectionRequestRef.current + 1
    detectionRequestRef.current = requestId
    detectionAbortRef.current?.abort()
    const controller = new AbortController()
    detectionAbortRef.current = controller

    setSuggestionLoading(true)
    setSuggestionError(null)
    setSuggestionUnavailable(false)

    try {
      const response = await detectRegions(
        image.id,
        false,
        controller.signal,
      )
      if (requestId !== detectionRequestRef.current) return

      const items = response.suggestions
        .slice(0, MAX_SUGGESTIONS)
        .map((suggestion, index) =>
          reviewDetectedSuggestion(
            suggestion,
            `suggestion-${++suggestionCounterRef.current}-${index}`,
          ),
        )

      setSuggestions(items)
      setActiveSuggestionKey(items[0]?.key ?? null)
      setSuggestionTruncated(response.truncated && !response.cached)

      if (items.length === 0) {
        showToast('No regions found.', 'info')
      }
    } catch (error) {
      if (isAbortError(error)) return
      if (requestId !== detectionRequestRef.current) return

      const unavailable =
        error instanceof ApiError &&
        error.code === 'DETECTION_UNAVAILABLE'
      setSuggestionUnavailable(unavailable)
      setSuggestionError(
        unavailable
          ? 'Suggestions are unavailable right now. Draw the regions manually.'
          : getErrorMessage(error),
      )
    } finally {
      if (requestId === detectionRequestRef.current) {
        setSuggestionLoading(false)
        if (detectionAbortRef.current === controller) {
          detectionAbortRef.current = null
        }
      }
    }
  }, [activeImage, showToast])

  useEffect(() => {
    return () => {
      detectionRequestRef.current += 1
      detectionAbortRef.current?.abort()
      detectionAbortRef.current = null
    }
  }, [activeImage?.id])

  const clearDraft = useCallback(() => {
    setTool('select')
    setDrawPoints([])
    setDrawError(null)
    setPendingShape(null)
    setPendingEditKey(null)
    setPendingShapeError(null)
  }, [])

  const beginDrawing = useCallback((nextTool: 'polygon' | 'line') => {
    setPendingShape(null)
    setPendingEditKey(null)
    setPendingShapeError(null)
    setDrawPoints([])
    setDrawError(null)
    setCalibrationDraft(null)
    setTool(nextTool)
    setShowToolHint(true)
  }, [])

  const activateSelect = useCallback(() => {
    setTool('select')
    setShowToolHint(true)
    setDrawPoints([])
    setDrawError(null)
    setPendingShape(null)
    setPendingEditKey(null)
    setPendingShapeError(null)
    setCalibrationDraft(null)
  }, [])

  const addDrawPoint = useCallback(
    (point: GeometryPoint) => {
      if (drawingTool === null) return

      const lastPoint = drawPoints[drawPoints.length - 1]
      if (
        lastPoint !== undefined &&
        computePointDistance(
          lastPoint,
          point,
          activeImage?.width ?? 0,
          activeImage?.height ?? 0,
        ) < 2
      ) {
        setDrawError(
          'That point sits on the last one. Click somewhere else.',
        )
        return
      }

      setDrawError(null)
      setDrawPoints((current) => [...current, point])
    },
    [activeImage, drawPoints, drawingTool],
  )

  const finishDrawing = useCallback(() => {
    if (drawingTool === null) return

    const problem = computeRegionGeometryProblem(
      drawingTool,
      drawPoints,
    )
    if (problem !== null) {
      setDrawError(problem)
      return
    }

    setPendingShape({
      geometryType: drawingTool,
      points: drawPoints.map((point) => ({ ...point })),
    })
    setPendingEditKey(null)
    setPendingShapeError(null)
    setDrawPoints([])
    setDrawError(null)
    setTool('select')
  }, [drawPoints, drawingTool])

  const removeLastDrawPoint = useCallback(() => {
    setDrawPoints((current) => current.slice(0, -1))
    setDrawError(null)
  }, [])

  const cancelDrawing = useCallback(() => {
    clearDraft()
  }, [clearDraft])

  const handlePendingShapeChange = useCallback(
    (points: GeometryPoint[]) => {
      setPendingShape((current) =>
        current === null ? current : { ...current, points },
      )
      setPendingShapeError(null)
    },
    [],
  )

  const handleCreateRegion = useCallback(
    (input: Parameters<typeof createRegion>[0]) => {
      const shapeProblem = computeRegionGeometryProblem(
        input.geometry_type,
        input.geometry_json,
      )
      if (shapeProblem !== null) {
        setPendingShapeError(shapeProblem)
        return
      }

      const editedKey = pendingEditKey
      createRegion(input)
      if (editedKey !== null) {
        setSuggestions((current) =>
          current.filter(
            (suggestion) => suggestion.key !== editedKey,
          ),
        )
      }
      clearDraft()
      showToast(
        editedKey === null ? 'Region added.' : 'Suggestion added.',
        'success',
      )
    },
    [clearDraft, createRegion, pendingEditKey, showToast],
  )

  const startEditSuggestion = useCallback(
    (key: string) => {
      const suggestion = suggestions.find(
        (item) => item.key === key,
      )
      if (suggestion === undefined) return

      const points = suggestion.geometry_json.map((point) => ({
        ...point,
      }))
      setPendingShape({
        geometryType: suggestion.geometry_type,
        points,
      })
      setPendingEditKey(key)
      setActiveSuggestionKey((current) => {
        if (current !== key) return current
        return (
          suggestions.find((item) => item.key !== key)?.key ?? null
        )
      })
      setPendingShapeError(
        computeRegionGeometryProblem(
          suggestion.geometry_type,
          points,
        ),
      )
      setDrawPoints([])
      setDrawError(null)
      setCalibrationDraft(null)
      setTool('select')
    },
    [suggestions],
  )

  const handleAcceptSuggestion = useCallback(
    (key: string) => {
      const suggestion = suggestions.find(
        (item) => item.key === key,
      )
      if (suggestion === undefined || suggestion.problem !== null) {
        return
      }

      createRegion({
        name: suggestion.name,
        geometry_type: suggestion.geometry_type,
        geometry_json: suggestion.geometry_json,
        surface_type: suggestion.surface_type,
        region_role: suggestion.region_role,
      })
      const remaining = suggestions.filter(
        (item) => item.key !== key,
      )
      setSuggestions(remaining)
      setActiveSuggestionKey((current) =>
        current === key ? (remaining[0]?.key ?? null) : current,
      )
      showToast('Suggestion added.', 'success')
    },
    [createRegion, showToast, suggestions],
  )

  const handleRejectSuggestion = useCallback(
    (key: string) => {
      const remaining = suggestions.filter(
        (item) => item.key !== key,
      )
      setSuggestions(remaining)
      setActiveSuggestionKey((current) =>
        current === key ? (remaining[0]?.key ?? null) : current,
      )
      if (pendingEditKey === key) clearDraft()
    },
    [clearDraft, pendingEditKey, suggestions],
  )

  const handleAcceptAllSuggestions = useCallback(() => {
    const accepted = suggestions.filter(
      (suggestion) =>
        suggestion.problem === null &&
        suggestion.key !== pendingEditKey,
    )

    if (accepted.length === 0) {
      showToast(
        'Edit the suggestions marked in red before accepting them.',
        'info',
      )
      return
    }

    for (const suggestion of accepted) {
      createRegion({
        name: suggestion.name,
        geometry_type: suggestion.geometry_type,
        geometry_json: suggestion.geometry_json,
        surface_type: suggestion.surface_type,
        region_role: suggestion.region_role,
      })
    }

    const acceptedKeys = new Set(
      accepted.map((suggestion) => suggestion.key),
    )
    const remaining = suggestions.filter(
      (suggestion) => !acceptedKeys.has(suggestion.key),
    )
    setSuggestions(remaining)
    setActiveSuggestionKey((current) =>
      current !== null && acceptedKeys.has(current)
        ? (remaining[0]?.key ?? null)
        : current,
    )
    const needsEdit = suggestions.filter(
      (suggestion) => suggestion.problem !== null,
    ).length
    showToast(
      needsEdit > 0
        ? `${accepted.length} ${accepted.length === 1 ? 'suggestion' : 'suggestions'} added. ${needsEdit} ${needsEdit === 1 ? 'needs' : 'need'} editing first.`
        : `${accepted.length} ${accepted.length === 1 ? 'suggestion' : 'suggestions'} added.`,
      'success',
    )
  }, [createRegion, pendingEditKey, showToast, suggestions])

  const handleRejectAllSuggestions = useCallback(() => {
    setSuggestions([])
    setActiveSuggestionKey(null)
    setSuggestionError(null)
    setSuggestionUnavailable(false)
    setSuggestionTruncated(false)
    if (pendingEditKey !== null) clearDraft()
  }, [clearDraft, pendingEditKey])

  const handleRetrySuggestions = useCallback(() => {
    void runDetection()
  }, [runDetection])

  const handleRegionGeometryChange = useCallback(
    (regionId: string, points: GeometryPoint[]) => {
      updateRegion(regionId, { geometry_json: points })
    },
    [updateRegion],
  )

  const handleSurfaceChange = useCallback(
    (surface: SurfaceType): SurfaceChangeResult => {
      if (selectedRegion === null) {
        return { ok: false, message: 'Select a region first.' }
      }

      const result = computeSurfaceChange(
        selectedRegion,
        surface,
        materials,
      )
      if (!result.ok || result.patch === undefined) return result

      updateRegion(selectedRegion.id, result.patch)
      setSurfaceNotice(
        result.notice
          ? { regionId: selectedRegion.id, message: result.notice }
          : null,
      )
      return result
    },
    [materials, selectedRegion, updateRegion],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }

      if (event.key === 'Escape' && pendingShape !== null) {
        event.preventDefault()
        cancelDrawing()
        return
      }

      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      if (pendingShape !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelDrawing()
        }
        return
      }

      if (drawingTool !== null) {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelDrawing()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          finishDrawing()
          return
        }
        if (event.key === 'Backspace' && drawPoints.length > 0) {
          event.preventDefault()
          removeLastDrawPoint()
          return
        }
        if (drawPoints.length > 0) return
      }

      if (calibrationDraft !== null && event.key === 'Escape') {
        event.preventDefault()
        setCalibrationDraft(null)
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'v') {
        event.preventDefault()
        activateSelect()
      } else if (key === 'p') {
        event.preventDefault()
        beginDrawing('polygon')
      } else if (key === 'l') {
        event.preventDefault()
        beginDrawing('line')
      } else if (key === 'c') {
        event.preventDefault()
        beginCalibration()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activateSelect,
    beginCalibration,
    beginDrawing,
    calibrationDraft,
    cancelDrawing,
    drawPoints.length,
    drawingTool,
    finishDrawing,
    pendingShape,
    removeLastDrawPoint,
  ])

  const cancelCalibration = useCallback(() => {
    setCalibrationDraft(null)
  }, [])

  const handleCalibrationPoint = useCallback((point: GeometryPoint) => {
    setCalibrationDraft((current) => {
      if (current === null || current.length >= 2) return current
      return [...current, point]
    })
  }, [])

  const handleMoveCalibrationPoint = useCallback(
    (index: 0 | 1, point: GeometryPoint) => {
      if (calibration === null || activeImage === null) return

      const otherPoint =
        index === 0
          ? { x: calibration.p2_x, y: calibration.p2_y }
          : { x: calibration.p1_x, y: calibration.p1_y }
      const distance = computePointDistance(
        point,
        otherPoint,
        activeImage.width,
        activeImage.height,
      )
      if (distance < MIN_CALIBRATION_DRAG_PX) return

      updateCalibration({
        length_ft: calibration.length_ft,
        p1_x: index === 0 ? point.x : calibration.p1_x,
        p1_y: index === 0 ? point.y : calibration.p1_y,
        p2_x: index === 1 ? point.x : calibration.p2_x,
        p2_y: index === 1 ? point.y : calibration.p2_y,
      })
    },
    [activeImage, calibration, updateCalibration],
  )

  const handleCalibrationDragEnd = useCallback(() => {
    void flushSaves()
  }, [flushSaves])

  const handleApplyDraft = useCallback(
    async (lengthFt: number) => {
      if (
        calibrationDraft === null ||
        calibrationDraft.length !== 2 ||
        !Number.isFinite(lengthFt) ||
        lengthFt <= 0
      ) {
        return
      }

      updateCalibration({
        length_ft: lengthFt,
        p1_x: calibrationDraft[0].x,
        p1_y: calibrationDraft[0].y,
        p2_x: calibrationDraft[1].x,
        p2_y: calibrationDraft[1].y,
      })
      setCalibrationDraft(null)
      await flushSaves()
    },
    [calibrationDraft, flushSaves, updateCalibration],
  )

  const handleLengthChange = useCallback(
    (lengthFt: number) => {
      if (calibration === null) return

      updateCalibration({
        length_ft: lengthFt,
        p1_x: calibration.p1_x,
        p1_y: calibration.p1_y,
        p2_x: calibration.p2_x,
        p2_y: calibration.p2_y,
      })
    },
    [calibration, updateCalibration],
  )

  const handleClearCalibration = useCallback(async () => {
    setClearCalibrationOpen(false)
    setCalibrationDraft(null)
    updateCalibration(null)
    await flushSaves()
  }, [flushSaves, updateCalibration])

  const handleSelectRegion = useCallback(
    (regionId: string) => {
      setSurfaceNotice((current) =>
        current?.regionId === regionId ? current : null,
      )
      selectRegion(regionId)
    },
    [selectRegion],
  )

  const handleToggleRegion = useCallback(
    (regionId: string) => {
      if (selectedId === regionId) {
        setSurfaceNotice(null)
        selectRegion(null)
        return
      }
      handleSelectRegion(regionId)
    },
    [handleSelectRegion, selectRegion, selectedId],
  )

  const handleToggleSuggestion = useCallback((key: string) => {
    setActiveSuggestionKey((current) =>
      current === key ? null : key,
    )
  }, [])

  const handleRename = useCallback(
    (name: string) => {
      if (selectedRegion === null) return
      updateRegion(selectedRegion.id, { name })
    },
    [selectedRegion, updateRegion],
  )

  const handleDeductionChange = useCallback(
    (value: number) => {
      if (selectedRegion === null) return
      updateRegion(selectedRegion.id, { deduction_sqft: value })
    },
    [selectedRegion, updateRegion],
  )

  const handleManualMeasureChange = useCallback(
    (value: number | null) => {
      if (selectedRegion === null) return
      updateRegion(
        selectedRegion.id,
        selectedRegion.geometry_type === 'polygon'
          ? { manual_area_sqft: value }
          : { manual_length_ft: value },
      )
    },
    [selectedRegion, updateRegion],
  )

  const handleDeleteConfirm = useCallback(() => {
    const regionId = deleteRegionId
    setDeleteRegionId(null)
    if (regionId === null) return

    deleteRegion(regionId)
    focusListAfterDeleteRef.current = true
  }, [deleteRegion, deleteRegionId])

  useEffect(() => {
    if (!focusListAfterDeleteRef.current) return

    focusListAfterDeleteRef.current = false
    const timer = window.setTimeout(() => {
      const target =
        selectedId === null
          ? null
          : document.getElementById(`region-row-${selectedId}`)
      if (target instanceof HTMLElement) {
        target.focus()
      } else {
        listRef.current?.focus()
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [regions.length, selectedId])

  const handleFlush = useCallback(() => {
    void flushSaves()
  }, [flushSaves])

  const closeDeleteDialog = useCallback(() => {
    setDeleteRegionId(null)
  }, [])

  const closeClearDialog = useCallback(() => {
    setClearCalibrationOpen(false)
  }, [])

  const confirmClearCalibration = useCallback(() => {
    void handleClearCalibration()
  }, [handleClearCalibration])

  if (project === null) return null

  if (activeImage === null) {
    return (
      <div className="screen-enter">
        <EmptyState
          icon={<ImageIcon className="size-5" strokeWidth={1.8} />}
          title="Add a photo first."
          action={
            <Button
              onClick={() => {
                void navigate('upload')
              }}
            >
              Back to photo
            </Button>
          }
        />
      </div>
    )
  }

  const scaleReady = calibration !== null && scaleFtPerPx !== null
  const continueBlocker =
    regions.length === 0
      ? 'Mark at least one region to continue.'
      : !scaleReady
        ? 'Set the scale on the photo before continuing.'
        : null

  return (
    <div className="screen-enter">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-measure">
              Step 2 of {STEPS.length}
            </p>
            <h1 className="display mt-2 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">
              Mark the areas you want to change.
            </h1>
          </div>
          {scaleReady ? null : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber-soft px-3 py-1 text-xs font-medium text-amber">
              <span
                className="size-1.5 rounded-full bg-amber"
                aria-hidden="true"
              />
              Scale not set
            </span>
          )}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.46fr)] lg:gap-8">
        <div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <section className="overflow-hidden rounded-[2px] border border-line bg-surface shadow-sheet">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-measure">
                  Facade sheet
                </span>
                <span
                  className="h-3 w-px bg-line"
                  aria-hidden="true"
                />
                <span className="text-xs text-muted">
                  Photo {photoNumber(project.images, activeImage.id)} ·{' '}
                  {activeImage.width} × {activeImage.height} px
                </span>
              </div>
              <span className="font-mono text-[10px] text-muted">
                {regions.length === 1
                  ? '1 region'
                  : `${regions.length} regions`}
              </span>
            </div>

            <div className="border-b border-line bg-surface-2/35 px-4 py-2.5 sm:px-5">
              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="group"
                  aria-label="Region tools"
                  className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={selectActive}
                    aria-label="Select regions (V)"
                    title="Select regions (V)"
                    onClick={activateSelect}
                    className={toolButtonClass(selectActive)}
                  >
                    <MousePointer2 className="size-3.5" aria-hidden="true" />
                    Select
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === 'polygon'}
                    aria-label="Draw an area (P)"
                    title="Draw an area (P)"
                    onClick={() => beginDrawing('polygon')}
                    className={toolButtonClass(tool === 'polygon')}
                  >
                    <Pentagon className="size-3.5" aria-hidden="true" />
                    Polygon
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool === 'line'}
                    aria-label="Draw a railing line (L)"
                    title="Draw a railing line (L)"
                    onClick={() => beginDrawing('line')}
                    className={toolButtonClass(tool === 'line')}
                  >
                    <Minus className="size-3.5" aria-hidden="true" />
                    Line
                  </button>
                  <button
                    type="button"
                    aria-pressed={calibrationDraft !== null}
                    aria-label="Set the scale (C)"
                    title="Set the scale (C)"
                    onClick={beginCalibration}
                    className={toolButtonClass(calibrationDraft !== null)}
                  >
                    <Ruler className="size-3.5" aria-hidden="true" />
                    Calibrate
                  </button>
                </div>

                {drawingTool !== null ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={finishDrawing}
                      disabled={drawProblem !== null}
                      title={drawProblem ?? undefined}
                      icon={<Check className="size-3.5" aria-hidden="true" />}
                    >
                      {drawingTool === 'polygon'
                        ? 'Finish shape'
                        : 'Finish line'}
                    </Button>
                    <span className="text-[11px] text-muted">
                      {drawPoints.length === 0
                        ? 'Tap the photo to start'
                        : `${drawPoints.length} ${
                            drawPoints.length === 1 ? 'point' : 'points'
                          }`}
                    </span>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    void runDetection()
                  }}
                  disabled={suggestionLoading}
                  className="group ml-auto inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-br from-amber to-[#7c3f0c] px-4 text-xs font-semibold text-surface shadow-[0_6px_18px_rgba(168,91,18,0.28)] transition-all hover:-translate-y-0.5 hover:shadow-[0_9px_24px_rgba(168,91,18,0.36)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber active:translate-y-0 disabled:cursor-wait disabled:opacity-80 sm:w-auto"
                >
                  {suggestionLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Sparkles
                      className="size-4 transition-transform group-hover:scale-110"
                      aria-hidden="true"
                    />
                  )}
                  {suggestionLoading ? 'Reading photo…' : 'Suggest regions'}
                </button>
              </div>
            </div>

            <div className="p-3 sm:p-5">
              <RegionCanvas
                image={activeImage}
                regions={regions}
                selectedRegionId={selectedId}
                calibration={calibration}
                scaleFtPerPx={scaleFtPerPx}
                calibrationDraft={calibrationDraft}
                drawingTool={drawingTool}
                draftGeometryType={draftGeometryType}
                drawPoints={drawPoints}
                drawError={drawError}
                pendingPoints={pendingShape?.points ?? null}
                pendingGeometryType={
                  pendingShape?.geometryType ?? null
                }
                suggestions={suggestions}
                hiddenSuggestionKey={pendingEditKey}
                activeSuggestionKey={activeSuggestionKey}
                containerRef={canvasRef}
                onSelectRegion={handleSelectRegion}
                onSelectSuggestion={setActiveSuggestionKey}
                onCalibrationPoint={handleCalibrationPoint}
                onMoveCalibrationPoint={handleMoveCalibrationPoint}
                onCalibrationDragEnd={handleCalibrationDragEnd}
                onAddDrawPoint={addDrawPoint}
                onFinishDraw={finishDrawing}
                onPendingPointChange={handlePendingShapeChange}
                onRegionGeometryChange={handleRegionGeometryChange}
              />
              {showToolHint ? (
                <div className="mt-3 flex items-start gap-2 rounded-[2px] border border-measure/25 bg-measure-soft/50 px-3 py-2 text-xs leading-5 text-ink-2">
                  <Info
                    className="mt-0.5 size-3.5 shrink-0 text-measure"
                    aria-hidden="true"
                  />
                  <p>{toolHint}</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          {showSuggestionTray ? (
            <SuggestionTray
              suggestions={traySuggestions}
              activeKey={activeSuggestionKey}
              loading={suggestionLoading}
              error={suggestionError}
              unavailable={suggestionUnavailable}
              truncated={suggestionTruncated}
              onActivate={handleToggleSuggestion}
              onAccept={handleAcceptSuggestion}
              onReject={handleRejectSuggestion}
              onAcceptAll={handleAcceptAllSuggestions}
              onRejectAll={handleRejectAllSuggestions}
              onEdit={startEditSuggestion}
              onRetry={handleRetrySuggestions}
              onCancel={cancelDetection}
            />
          ) : null}

          {pendingShape !== null ? (
            <NewRegionForm
              key={`${pendingEditKey ?? 'draw'}:${pendingShape.geometryType}:${pendingShape.points.length}`}
              geometryType={pendingShape.geometryType}
              points={pendingShape.points}
              regions={regions}
              scaleFtPerPx={scaleFtPerPx}
              width={width}
              height={height}
              initialSurface={editingSuggestion?.surface_type}
              initialName={editingSuggestion?.name}
              shapeProblem={pendingShapeError}
              heading={
                editingSuggestion === null
                  ? 'Name this region'
                  : 'Edit before accepting'
              }
              onAdd={handleCreateRegion}
              onCancel={cancelDrawing}
            />
          ) : null}

          <RegionList
            regions={regions}
            materials={materials}
            selectedRegionId={selectedId}
            scaleFtPerPx={scaleFtPerPx}
            width={width}
            height={height}
            onSelectRegion={handleToggleRegion}
            listRef={listRef}
          />

          <RegionInspector
            key={`${selectedId ?? 'no-region'}:${selectedRegion?.surface_type ?? ''}:${selectedRegion?.region_role ?? ''}`}
            region={selectedRegion}
            openings={openings}
            scaleFtPerPx={scaleFtPerPx}
            width={width}
            height={height}
            saveError={selectedRegionError}
            surfaceNotice={
              surfaceNotice?.regionId === selectedId
                ? surfaceNotice.message
                : null
            }
            onRename={handleRename}
            onDeductionChange={handleDeductionChange}
            onManualMeasureChange={handleManualMeasureChange}
            onSurfaceChange={handleSurfaceChange}
            onDelete={() => {
              if (selectedId !== null) setDeleteRegionId(selectedId)
            }}
            onSetScale={beginCalibration}
            onFlush={handleFlush}
          />

          <CalibrationCard
            calibration={calibration}
            scaleFtPerPx={scaleFtPerPx}
            width={width}
            height={height}
            draftPoints={calibrationDraft}
            error={calibrationError}
            onBegin={beginCalibration}
            onCancel={cancelCalibration}
            onApplyDraft={handleApplyDraft}
            onLengthChange={handleLengthChange}
            onClear={() => setClearCalibrationOpen(true)}
            onFlush={handleFlush}
          />
        </aside>
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate('upload')
            }}
            icon={<ArrowLeft className="size-4" aria-hidden="true" />}
          >
            Back to photo
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <p className="text-xs text-muted">{summary}</p>
          <span
            title={continueBlocker ?? undefined}
            className={cn(
              'inline-flex w-full sm:w-auto',
              continueBlocker !== null && 'cursor-not-allowed',
            )}
          >
            <Button
              size="lg"
              disabled={continueBlocker !== null}
              aria-describedby={
                continueBlocker === null ? undefined : 'continue-blocker'
              }
              onClick={() => {
                void navigate('materials')
              }}
              icon={<ArrowRight className="size-4" aria-hidden="true" />}
              className={cn(
                'w-full sm:w-auto',
                continueBlocker !== null && 'pointer-events-none',
              )}
            >
              Continue to materials
            </Button>
          </span>
          {continueBlocker !== null ? (
            <p
              id="continue-blocker"
              className="text-[11px] leading-4 text-muted"
            >
              {continueBlocker}
            </p>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={deleteRegionId !== null}
        title="Delete this region?"
        description={
          deleteTarget === null
            ? 'This region will be removed from the photo. This can’t be undone.'
            : `“${deleteTarget.name}” will be removed from the photo. This can’t be undone.`
        }
        confirmLabel="Delete region"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={closeDeleteDialog}
      />

      <ConfirmDialog
        open={clearCalibrationOpen}
        title="Clear the scale?"
        description="Every area that relies on the scale becomes unmeasured until you set it again. Manual measures stay."
        confirmLabel="Clear scale"
        destructive
        onConfirm={confirmClearCalibration}
        onCancel={closeClearDialog}
      />
    </div>
  )
}
