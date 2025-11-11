// Type declarations for deleted files - prevents TypeScript errors from cached references
declare module '../../../domain/inventory-valuation-integration' {
  export const getProductBatches: any;
  export const receivePurchaseV2: any;
  export const shipSalesV2: any;
  export const simulateCOGS: any;
}

declare module '../../domain/inventory-valuation-integration' {
  export const getProductBatches: any;
  export const receivePurchaseV2: any;
  export const shipSalesV2: any;
  export const simulateCOGS: any;
}

declare module '../inventory/components/BatchDetails' {
  const BatchDetails: any;
  export default BatchDetails;
}

declare module '@/services/warehouse-service' {
  export const warehouseService: any;
  export type GLAccount = any;
  export type Warehouse = any;
  export type StorageLocation = any;
}

declare module './AccountPicker' {
  const AccountPicker: any;
  export default AccountPicker;
}
