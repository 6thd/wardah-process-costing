// src/types/auth.ts
// Authentication and user management type definitions

export interface User {
  id: string
  org_id: string
  email: string
  full_name: string
  role: 'admin' | 'manager' | 'supervisor' | 'operator'
  is_active: boolean
  last_login: string | null
  created_at: string
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  code: string
  address: string
  phone: string
  email: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData {
  email: string
  password: string
  fullName: string
  orgName: string
}