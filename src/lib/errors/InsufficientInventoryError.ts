/**
 * Insufficient Inventory Error
 * 
 * Thrown when there is not enough inventory for an operation
 */

import { AppError } from './AppError';

export class InsufficientInventoryError extends AppError {
  public readonly itemId: string;
  public readonly required: number;
  public readonly available: number;
  public readonly itemName?: string;

  constructor(
    itemId: string,
    required: number,
    available: number,
    itemName?: string
  ) {
    const message = itemName
      ? `المخزون غير كافٍ للمادة "${itemName}". المطلوب: ${required}، المتاح: ${available}`
      : `المخزون غير كافٍ. المطلوب: ${required}، المتاح: ${available}`;

    super(
      'INSUFFICIENT_INVENTORY',
      message,
      400,
      true,
      { itemId, required, available, itemName }
    );
    
    this.itemId = itemId;
    this.required = required;
    this.available = available;
    this.itemName = itemName;
    this.name = 'InsufficientInventoryError';
  }
}

