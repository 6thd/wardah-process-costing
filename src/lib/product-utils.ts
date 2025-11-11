/**
 * Product Utilities - ERPNext-inspired patterns
 * Handles product loading with proper filtering for category items
 */

import { supabase } from '@/lib/supabase'

/**
 * Category item codes that should be excluded from product lists
 * These are summary/category items like "All / Finished Goods" with counts
 */
const CATEGORY_ITEM_CODES = ['FG-001', 'RM-001']
const CATEGORY_ITEM_CODES_IN = `(${CATEGORY_ITEM_CODES.map((code) => `"${code}"`).join(',')})`

/**
 * Load all purchasable products (excluding category items and finished goods)
 * Used in Purchase Orders and Supplier Invoices
 */
export async function loadPurchasableProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .not('code', 'in', CATEGORY_ITEM_CODES_IN)
      .order('name')
    
    if (error) throw error
    
    // Additional defensive filter
    const filteredProducts = (data || []).filter(p => 
      !p.name?.includes('All /') && 
      !CATEGORY_ITEM_CODES.includes(p.code)
    )
    
    return filteredProducts
  } catch (error) {
    console.error('Error loading purchasable products:', error)
    throw error
  }
}

/**
 * Load all sellable products (finished goods only)
 * Used in Sales Invoices and Delivery Notes
 */
export async function loadSellableProducts() {
  try {
    // Get Finished Goods category
    const { data: categories } = await supabase
      .from('categories')
      .select('id')
      .or('name.eq.Finished Goods,name_ar.eq.منتجات تامة')
    
    const finishedGoodsCategoryId = categories?.[0]?.id
    
    if (!finishedGoodsCategoryId) {
      throw new Error('Finished Goods category not found')
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('category_id', finishedGoodsCategoryId)
      .not('code', 'in', CATEGORY_ITEM_CODES_IN)
      .order('name')
    
    if (error) throw error
    
    // Additional defensive filter
    const filteredProducts = (data || []).filter(p => 
      !p.name?.includes('All /') && 
      !CATEGORY_ITEM_CODES.includes(p.code)
    )
    
    return filteredProducts
  } catch (error) {
    console.error('Error loading sellable products:', error)
    throw error
  }
}

/**
 * Load all products (excluding only category items)
 * Used in general product lists and inventory management
 */
export async function loadAllProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .not('code', 'in', CATEGORY_ITEM_CODES_IN)
      .order('name')
    
    if (error) throw error
    
    // Additional defensive filter
    const filteredProducts = (data || []).filter(p => 
      !p.name?.includes('All /') && 
      !CATEGORY_ITEM_CODES.includes(p.code)
    )
    
    return filteredProducts
  } catch (error) {
    console.error('Error loading products:', error)
    throw error
  }
}

/**
 * Load raw materials only
 * Used in BOM and manufacturing processes
 */
export async function loadRawMaterials() {
  try {
    // Get Raw Materials category
    const { data: categories } = await supabase
      .from('categories')
      .select('id')
      .or('name.eq.Raw Materials,name_ar.eq.مواد خام')
    
    const rawMaterialsCategoryId = categories?.[0]?.id
    
    if (!rawMaterialsCategoryId) {
      throw new Error('Raw Materials category not found')
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('category_id', rawMaterialsCategoryId)
      .not('code', 'in', CATEGORY_ITEM_CODES_IN)
      .order('name')
    
    if (error) throw error
    
    // Additional defensive filter
    const filteredProducts = (data || []).filter(p => 
      !p.name?.includes('All /') && 
      !CATEGORY_ITEM_CODES.includes(p.code)
    )
    
    return filteredProducts
  } catch (error) {
    console.error('Error loading raw materials:', error)
    throw error
  }
}

/**
 * Check if a product code is a category item
 */
export function isCategoryItem(productCode: string): boolean {
  return CATEGORY_ITEM_CODES.includes(productCode)
}
