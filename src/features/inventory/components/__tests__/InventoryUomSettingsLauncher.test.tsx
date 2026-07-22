import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryUomSettingsLauncher } from '../InventoryUomSettingsLauncher'

const useUomEngineEnabled = vi.fn()
const productUomSettings = vi.fn()
