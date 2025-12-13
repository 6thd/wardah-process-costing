/**
 * Integration Tests for lib/errors/
 * 
 * Tests error classes to increase coverage
 */

import { describe, it, expect } from 'vitest'
import { AppError } from '../AppError'
import { ValidationError, type FieldError } from '../ValidationError'
import { NotFoundError } from '../NotFoundError'
import { ForbiddenError } from '../ForbiddenError'
import { UnauthorizedError } from '../UnauthorizedError'

describe('Integration: lib/errors', () => {
  
  describe('AppError', () => {
    it('should create error with all properties', () => {
      const error = new AppError(
        'TEST_ERROR',
        'Test error message',
        400,
        true,
        { userId: '123' }
      )
      
      expect(error.code).toBe('TEST_ERROR')
      expect(error.message).toBe('Test error message')
      expect(error.statusCode).toBe(400)
      expect(error.isOperational).toBe(true)
      expect(error.context).toEqual({ userId: '123' })
      expect(error.timestamp).toBeInstanceOf(Date)
    })
    
    it('should use default values', () => {
      const error = new AppError('BASIC_ERROR', 'Basic message')
      
      expect(error.statusCode).toBe(500)
      expect(error.isOperational).toBe(true)
      expect(error.context).toBeUndefined()
    })
    
    it('should extend Error class', () => {
      const error = new AppError('TEST', 'Test')
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('AppError')
    })
    
    it('should convert to JSON correctly', () => {
      const error = new AppError('JSON_TEST', 'JSON message', 422, false, { key: 'value' })
      const json = error.toJSON()
      
      expect(json.code).toBe('JSON_TEST')
      expect(json.message).toBe('JSON message')
      expect(json.statusCode).toBe(422)
      expect(json.isOperational).toBe(false)
      expect(json.context).toEqual({ key: 'value' })
      expect(json.timestamp).toBeDefined()
    })
    
    it('should have stack trace', () => {
      const error = new AppError('STACK_TEST', 'Stack message')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('Stack message')
    })
  })
  
  describe('ValidationError', () => {
    it('should create validation error with field errors', () => {
      const fieldErrors: FieldError[] = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short', code: 'MIN_LENGTH' }
      ]
      
      const error = new ValidationError('Validation failed', fieldErrors)
      
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.statusCode).toBe(400)
      expect(error.errors).toHaveLength(2)
      expect(error.errors[0].field).toBe('email')
    })
    
    it('should add errors dynamically', () => {
      const error = new ValidationError('Validation failed')
      
      error.addError('username', 'Username required', 'REQUIRED')
      error.addError('age', 'Must be positive')
      
      expect(error.errors).toHaveLength(2)
      expect(error.errors[0].code).toBe('REQUIRED')
    })
    
    it('should check if field has error', () => {
      const error = new ValidationError('Error', [
        { field: 'email', message: 'Invalid' }
      ])
      
      expect(error.hasError('email')).toBe(true)
      expect(error.hasError('password')).toBe(false)
    })
    
    it('should get error message for field', () => {
      const error = new ValidationError('Error', [
        { field: 'name', message: 'Name is required' }
      ])
      
      expect(error.getError('name')).toBe('Name is required')
      expect(error.getError('unknown')).toBeUndefined()
    })
    
    it('should extend AppError', () => {
      const error = new ValidationError('Test')
      expect(error).toBeInstanceOf(AppError)
      expect(error).toBeInstanceOf(Error)
    })
  })
  
  describe('NotFoundError', () => {
    it('should create with resource name', () => {
      const error = new NotFoundError('User')
      
      expect(error.code).toBe('NOT_FOUND')
      expect(error.statusCode).toBe(404)
      expect(error.message).toContain('User')
    })
    
    it('should extend AppError', () => {
      const error = new NotFoundError('Product')
      expect(error).toBeInstanceOf(AppError)
    })
  })
  
  describe('ForbiddenError', () => {
    it('should create with message', () => {
      const error = new ForbiddenError('Access denied')
      
      expect(error.code).toBe('FORBIDDEN')
      expect(error.statusCode).toBe(403)
      expect(error.message).toBe('Access denied')
    })
    
    it('should use default message', () => {
      const error = new ForbiddenError()
      expect(error.message).toBeDefined()
    })
  })
  
  describe('UnauthorizedError', () => {
    it('should create with message', () => {
      const error = new UnauthorizedError('Invalid token')
      
      expect(error.code).toBe('UNAUTHORIZED')
      expect(error.statusCode).toBe(401)
    })
    
    it('should use default message', () => {
      const error = new UnauthorizedError()
      expect(error.message).toBeDefined()
    })
  })
  
  describe('Error Hierarchy', () => {
    it('all errors should be catchable as AppError', () => {
      const errors = [
        new ValidationError('test'),
        new NotFoundError('test'),
        new ForbiddenError('test'),
        new UnauthorizedError('test')
      ]
      
      errors.forEach(error => {
        expect(error).toBeInstanceOf(AppError)
        expect(error).toBeInstanceOf(Error)
      })
    })
    
    it('all errors should have timestamp', () => {
      const errors = [
        new AppError('TEST', 'test'),
        new ValidationError('test'),
        new NotFoundError('test'),
        new ForbiddenError('test'),
        new UnauthorizedError('test')
      ]
      
      errors.forEach(error => {
        expect(error.timestamp).toBeInstanceOf(Date)
      })
    })
  })
})
