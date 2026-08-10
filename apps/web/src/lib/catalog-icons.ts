export type CatalogIconMode = 'original' | 'monochrome'

export interface CatalogIconReference {
  id: string
  mode: CatalogIconMode
  lightUrl: string
  darkUrl: string
}
export interface AdminCatalogIcon extends CatalogIconReference {
  name: string
  usage: { labs: number; models: number; total: number }
  createdAt: string
  updatedAt: string
}
