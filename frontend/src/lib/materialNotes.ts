const MATERIAL_NOTES: Record<string, string> = {
  paint_emulsion:
    'Repaint every three to five years; washable finish handles monsoon grime.',
  paint_metallic:
    'A metallic sheen hides small flaws; seal it against sun and salt air.',
  paint_texture:
    'Texture hides wall unevenness; keep it sealed against damp.',
  microcement:
    'Seamless and slim; a waterproof topcoat and a skilled applicator matter.',
  stone_cladding:
    'Durable and weatherproof; heavier panels need sound fixing.',
  sandstone_cladding:
    'Warm, porous stone; seal it against monsoon damp and efflorescence.',
  granite_cladding:
    'Hard and stain-resistant; a honed or flamed finish keeps glare down.',
  lime_plaster:
    'Breathable and deeply matt; let it cure slowly and keep it sealed.',
  acp_cladding:
    'Lightweight panels with crisp joints; specify fire-rated cores for safety.',
  hpl_cladding:
    'UV-stable and scratch-resistant; leave a ventilation gap behind panels.',
  terracotta_cladding:
    'Breathable and fire-safe; the rainscreen gap keeps the wall dry.',
  wall_tiles:
    'Easy to wash; check grout lines for chipping over time.',
  porcelain_panel:
    'Large panels resist stains and fading; joints need precise alignment.',
  wpc_panel:
    'Rot-resistant and low upkeep; avoid direct flame and sharp impacts.',
  metal_railing:
    'Strong and low-maintenance; repaint if rust spots appear.',
  glass_railing:
    'Bright and rust-free; clean regularly and inspect fittings yearly.',
  stainless_railing:
    'Cable infill keeps views open; check tension and fittings yearly.',
}

export function getMaterialNote(materialId: string): string {
  return (
    MATERIAL_NOTES[materialId] ??
    'Ask the supplier for care and maintenance guidance.'
  )
}
