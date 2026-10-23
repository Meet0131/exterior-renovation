export type SurfaceType =
  | 'wall'
  | 'pillar'
  | 'parapet'
  | 'railing'
  | 'balcony_slab'
  | 'gate'
  | 'roof_edge'
  | 'trim'
  | 'window'
  | 'door'

export type RegionRole = 'finish' | 'opening' | 'reference'
export type GeometryType = 'polygon' | 'line'

export interface GeometryPoint {
  x: number
  y: number
}

export interface Project {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ProjectImage {
  id: string
  sort_order: number
  width: number
  height: number
  created_at: string
}

export interface ProjectDetail extends Project {
  images: ProjectImage[]
}

export interface ProjectSummary extends Project {
  image_count: number
  cover_image_id: string | null
}

export interface CreateProjectPayload {
  title?: string
}

export interface UpdateProjectPayload {
  title: string
}

export interface CalibrationPayload {
  length_ft: number
  p1_x: number
  p1_y: number
  p2_x: number
  p2_y: number
}

export interface Calibration extends CalibrationPayload {
  image_id: string
}

export interface ImageUpload {
  id: string
  project_id: string
  sort_order: number
  width: number
  height: number
  created_at: string
}

export interface UpdateImagePayload {
  sort_order?: number
  calibration?: CalibrationPayload | null
}

export interface ImageUpdate extends ImageUpload {
  calibration: CalibrationPayload | null
}

export interface FinalizeResponse {
  image_id: string
  stored: boolean
  width: number
  height: number
  size_bytes: number
}

export interface Region {
  id: string
  image_id: string
  name: string
  sort_order: number
  geometry_type: GeometryType
  geometry_json: GeometryPoint[]
  surface_type: SurfaceType
  region_role: RegionRole
  manual_area_sqft: number | null
  manual_length_ft: number | null
  deduction_sqft: number
  material_id: string | null
  color_hex: string | null
  material_rate_override: number | null
  labor_rate_override: number | null
}

export interface RegionList {
  image_id: string
  regions: Region[]
}

export interface RegionWritePayload {
  id?: string | null
  name: string
  sort_order: number
  geometry_type: GeometryType
  geometry_json: GeometryPoint[]
  surface_type: SurfaceType
  region_role: RegionRole
  manual_area_sqft: number | null
  manual_length_ft: number | null
  deduction_sqft: number
  material_id: string | null
  color_hex: string | null
  material_rate_override: number | null
  labor_rate_override: number | null
}

export interface RegionPatchPayload {
  name?: string
  sort_order?: number
  geometry_type?: GeometryType
  geometry_json?: GeometryPoint[]
  surface_type?: SurfaceType
  region_role?: RegionRole
  manual_area_sqft?: number | null
  manual_length_ft?: number | null
  deduction_sqft?: number
  material_id?: string | null
  color_hex?: string | null
  material_rate_override?: number | null
  labor_rate_override?: number | null
}

export interface Material {
  id: string
  name: string
  category: string
  unit: string
  surfaces: SurfaceType[]
  coverage_per_unit: number
  coats: number
  pack_sizes?: number[]
  waste_pct: number
  material_rate: number
  labor_rate: number
  labor_unit: string
  colors: string[]
  texture: string
}

export interface MaterialCatalog {
  materials: Material[]
}

export interface DetectedRegionSuggestion {
  name: string
  geometry_type: GeometryType
  geometry_json: GeometryPoint[]
  surface_type: SurfaceType
  region_role: RegionRole
  confidence: number
}

export interface DetectionResponse {
  image_id: string
  suggestions: DetectedRegionSuggestion[]
  detected_at: string
  cached: boolean
  truncated: boolean
}

export interface EstimateLine {
  region_id: string
  region_name: string
  material_name: string
  final_measure: number
  measure_unit: string
  waste_pct: number
  purchase_qty: number
  purchase_unit: string
  material_rate: number
  labor_rate: number
  material_cost: number
  labor_cost: number
  line_total: number
}

export interface ImageEstimate {
  contingency_pct: number
  lines: EstimateLine[]
  subtotal_material: number
  subtotal_labor: number
  contingency: number
  grand_total: number
}

export interface ProjectImageEstimate {
  image_id: string
  subtotal_material: number
  subtotal_labor: number
}

export interface ProjectEstimate {
  contingency_pct: number
  images: ProjectImageEstimate[]
  subtotal_material: number
  subtotal_labor: number
  contingency: number
  grand_total: number
}

export interface DownloadedFile {
  blob: Blob
  filename: string
}
