// Type declarations for manufacturing.js

export interface WorkCenter {
  id: string
  code: string
  name: string
}

export interface ManufacturingOrder {
  id: string
  order_number: string
  item?: {
    name: string
  }
  status: string
}

export function getAllWorkCenters(): Promise<any>
export function getAllManufacturingOrders(): Promise<any>
export function getManufacturingOrderById(id: string): Promise<any>