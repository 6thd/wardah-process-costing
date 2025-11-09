/**
 * BaseController - ERPNext Pattern
 * 
 * Base class for all document controllers in Wardah ERP.
 * Inspired by frappe.model.document.Document and erpnext.controllers.status_updater.StatusUpdater
 * 
 * Lifecycle Hooks:
 * - validate() - called before save
 * - before_save() - called before save
 * - after_save() - called after save
 * - on_submit() - called when document is submitted
 * - on_cancel() - called when document is cancelled
 * - on_update_after_submit() - called when submitted document is updated
 * 
 * Status Flow:
 * Draft → Submitted → Cancelled
 */

import { supabase } from '@/lib/supabase'

export interface BaseDocument {
  id?: string
  org_id?: string
  docstatus?: number  // 0 = Draft, 1 = Submitted, 2 = Cancelled
  name?: string       // Document number
  status?: string
  created_at?: string
  updated_at?: string
  created_by?: string
  modified_by?: string
}

export abstract class BaseController<T extends BaseDocument> {
  protected tableName: string
  protected doc: Partial<T>
  protected oldDoc?: Partial<T>

  constructor(tableName: string, doc: Partial<T> = {}) {
    this.tableName = tableName
    this.doc = doc
  }

  // ==================== Lifecycle Hooks ====================
  // Override these in child classes

  /**
   * Validate document before save
   * Throw error if validation fails
   */
  protected async validate(): Promise<void> {
    // Override in child class
  }

  /**
   * Called before document is saved
   */
  protected async before_save(): Promise<void> {
    // Override in child class
  }

  /**
   * Called after document is saved
   */
  protected async after_save(): Promise<void> {
    // Override in child class
  }

  /**
   * Called when document is submitted (docstatus = 1)
   */
  protected async on_submit(): Promise<void> {
    // Override in child class
  }

  /**
   * Called when document is cancelled (docstatus = 2)
   */
  protected async on_cancel(): Promise<void> {
    // Override in child class
  }

  /**
   * Called when submitted document is updated
   */
  protected async on_update_after_submit(): Promise<void> {
    // Override in child class
  }

  // ==================== CRUD Operations ====================

  /**
   * Load document from database
   */
  async load(id: string): Promise<T> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw new Error(`Failed to load ${this.tableName}: ${error.message}`)
    if (!data) throw new Error(`${this.tableName} not found`)

    this.doc = data as T
    this.oldDoc = { ...data } as T
    return this.doc as T
  }

  /**
   * Save document (create or update)
   */
  async save(): Promise<T> {
    // Set timestamps
    if (!this.doc.id) {
      this.doc.created_at = new Date().toISOString()
    }
    this.doc.updated_at = new Date().toISOString()

    // Set docstatus to draft if not set
    if (this.doc.docstatus === undefined) {
      this.doc.docstatus = 0
    }

    // Run lifecycle hooks
    await this.validate()
    await this.before_save()

    // Save to database
    let savedDoc: T

    if (this.doc.id) {
      // Update
      const { data, error } = await supabase
        .from(this.tableName)
        .update(this.doc as any)
        .eq('id', this.doc.id)
        .select()
        .single()

      if (error) throw new Error(`Failed to update ${this.tableName}: ${error.message}`)
      savedDoc = data as T
    } else {
      // Insert
      const { data, error } = await supabase
        .from(this.tableName)
        .insert(this.doc as any)
        .select()
        .single()

      if (error) throw new Error(`Failed to insert ${this.tableName}: ${error.message}`)
      savedDoc = data as T
    }

    this.doc = savedDoc
    await this.after_save()

    return savedDoc
  }

  /**
   * Submit document (change docstatus from 0 to 1)
   */
  async submit(): Promise<T> {
    if (!this.doc.id) {
      throw new Error('Cannot submit unsaved document')
    }

    if (this.doc.docstatus !== 0) {
      throw new Error(`Cannot submit document with docstatus ${this.doc.docstatus}`)
    }

    // Validate before submit
    await this.validate()

    // Update docstatus
    this.doc.docstatus = 1
    this.doc.status = 'Submitted'

    await this.on_submit()

    // Save to database
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ 
        docstatus: 1, 
        status: 'Submitted',
        updated_at: new Date().toISOString()
      } as any)
      .eq('id', this.doc.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to submit ${this.tableName}: ${error.message}`)

    this.doc = data as T
    return data as T
  }

  /**
   * Cancel document (change docstatus from 1 to 2)
   */
  async cancel(): Promise<T> {
    if (!this.doc.id) {
      throw new Error('Cannot cancel unsaved document')
    }

    if (this.doc.docstatus !== 1) {
      throw new Error(`Cannot cancel document with docstatus ${this.doc.docstatus}`)
    }

    await this.on_cancel()

    // Update docstatus
    this.doc.docstatus = 2
    this.doc.status = 'Cancelled'

    // Save to database
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ 
        docstatus: 2, 
        status: 'Cancelled',
        updated_at: new Date().toISOString()
      } as any)
      .eq('id', this.doc.id)
      .select()
      .single()

    if (error) throw new Error(`Failed to cancel ${this.tableName}: ${error.message}`)

    this.doc = data as T
    return data as T
  }

  /**
   * Delete document (only if draft)
   */
  async delete(): Promise<void> {
    if (!this.doc.id) {
      throw new Error('Cannot delete unsaved document')
    }

    if (this.doc.docstatus !== 0) {
      throw new Error('Can only delete draft documents')
    }

    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', this.doc.id)

    if (error) throw new Error(`Failed to delete ${this.tableName}: ${error.message}`)
  }

  // ==================== Helper Methods ====================

  /**
   * Get document data
   */
  getData(): Partial<T> {
    return this.doc
  }

  /**
   * Set document data
   */
  setData(data: Partial<T>): void {
    this.doc = { ...this.doc, ...data }
  }

  /**
   * Get old document data (before save)
   */
  getOldData(): Partial<T> | undefined {
    return this.oldDoc
  }

  /**
   * Check if field value changed
   */
  hasValueChanged(field: keyof T): boolean {
    if (!this.oldDoc) return true
    return this.doc[field] !== this.oldDoc[field]
  }

  /**
   * Set value in document
   */
  setValue(field: keyof T, value: any): void {
    this.doc[field] = value
  }

  /**
   * Get value from document
   */
  getValue(field: keyof T): any {
    return this.doc[field]
  }

  /**
   * Check if document is new (not saved)
   */
  isNew(): boolean {
    return !this.doc.id
  }

  /**
   * Check if document is draft
   */
  isDraft(): boolean {
    return this.doc.docstatus === 0
  }

  /**
   * Check if document is submitted
   */
  isSubmitted(): boolean {
    return this.doc.docstatus === 1
  }

  /**
   * Check if document is cancelled
   */
  isCancelled(): boolean {
    return this.doc.docstatus === 2
  }
}
