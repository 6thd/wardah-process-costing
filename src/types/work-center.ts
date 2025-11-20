// src/types/work-center.ts
// Shared WorkCenter type definition

export interface WorkCenter {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string
  description: string | null
  hourly_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
}

