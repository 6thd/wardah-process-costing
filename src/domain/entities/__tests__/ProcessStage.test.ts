/**
 * Tests for domain/entities/ProcessStage.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { ProcessStage, StageStatus } from '../ProcessStage';

describe('ProcessStage Entity', () => {
  describe('creation', () => {
    it('should create ProcessStage with valid data', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1);
      
      expect(stage.id).toBe('stage-1');
      expect(stage.name).toBe('Mixing');
      expect(stage.sequence).toBe(1);
      expect(stage.status).toBe(StageStatus.NOT_STARTED);
    });

    it('should create ProcessStage with initial units', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1, 100);
      
      expect(stage.unitsStarted.value).toBe(100);
      expect(stage.unitsCompleted.value).toBe(0);
    });

    it('should create ProcessStage with custom currency', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1, 0, 'USD');
      
      expect(stage.accumulatedCost.currency).toBe('USD');
    });

    it('should throw for invalid sequence', () => {
      expect(() => ProcessStage.create('stage-1', 'Mixing', 0)).toThrow('Sequence must be at least 1');
      expect(() => ProcessStage.create('stage-1', 'Mixing', -1)).toThrow('Sequence must be at least 1');
    });

    it('should create from raw data', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100,
        unitsCompleted: 50,
        completionPercentage: 75,
        accumulatedCost: 1000,
        currency: 'SAR'
      });
      
      expect(stage.status).toBe(StageStatus.IN_PROGRESS);
      expect(stage.unitsStarted.value).toBe(100);
      expect(stage.unitsCompleted.value).toBe(50);
      expect(stage.completionPercentage).toBe(75);
      expect(stage.accumulatedCost.amount).toBe(1000);
    });
  });

  describe('computed properties', () => {
    it('should calculate unitsInProgress', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1', name: 'Test', sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 60,
        completionPercentage: 50, accumulatedCost: 0
      });
      
      expect(stage.unitsInProgress.value).toBe(40);
    });

    it('should calculate wipPercentage', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1', name: 'Test', sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 60,
        completionPercentage: 50, accumulatedCost: 0
      });
      
      expect(stage.wipPercentage).toBe(40);
    });

    it('should return 0 wipPercentage when no units started', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 0);
      expect(stage.wipPercentage).toBe(0);
    });

    it('should calculate equivalentUnits', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1', name: 'Test', sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 60,
        completionPercentage: 50, accumulatedCost: 0
      });
      
      // 60 completed + (40 * 50%) = 60 + 20 = 80
      expect(stage.equivalentUnits).toBe(80);
    });

    it('should calculate costPerEquivalentUnit', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1', name: 'Test', sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 60,
        completionPercentage: 50, accumulatedCost: 1600
      });
      
      // 1600 / 80 = 20
      expect(stage.costPerEquivalentUnit.amount).toBe(20);
    });

    it('should return zero costPerEquivalentUnit when no equivalent units', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 0);
      expect(stage.costPerEquivalentUnit.amount).toBe(0);
    });
  });

  describe('status transitions', () => {
    it('should start stage from NOT_STARTED', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      const started = stage.start();
      
      expect(started.status).toBe(StageStatus.IN_PROGRESS);
    });

    it('should complete stage from IN_PROGRESS', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 100).start();
      const completed = stage.complete();
      
      expect(completed.status).toBe(StageStatus.COMPLETED);
      expect(completed.unitsCompleted.value).toBe(100);
      expect(completed.completionPercentage).toBe(100);
    });

    it('should put on hold from IN_PROGRESS', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1).start();
      const onHold = stage.putOnHold();
      
      expect(onHold.status).toBe(StageStatus.ON_HOLD);
    });

    it('should resume from ON_HOLD', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1).start().putOnHold();
      const resumed = stage.resume();
      
      expect(resumed.status).toBe(StageStatus.IN_PROGRESS);
    });

    it('should start stage from ON_HOLD', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1).start().putOnHold();
      const started = stage.start();
      
      expect(started.status).toBe(StageStatus.IN_PROGRESS);
    });

    it('should throw when completing non-IN_PROGRESS stage', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      expect(() => stage.complete()).toThrow();
    });

    it('should throw when putting non-IN_PROGRESS stage on hold', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      expect(() => stage.putOnHold()).toThrow();
    });

    it('should throw when resuming non-ON_HOLD stage', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      expect(() => stage.resume()).toThrow();
    });
  });

  describe('with* methods (immutable updates)', () => {
    it('withUnitsStarted should update units', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      const updated = stage.withUnitsStarted(50);
      
      expect(updated.unitsStarted.value).toBe(50);
      expect(stage.unitsStarted.value).toBe(0); // Original unchanged
    });

    it('withUnitsStarted should throw for negative units', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      expect(() => stage.withUnitsStarted(-10)).toThrow('Units cannot be negative');
    });

    it('withUnitsCompleted should update units', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 100);
      const updated = stage.withUnitsCompleted(60);
      
      expect(updated.unitsCompleted.value).toBe(60);
    });

    it('withUnitsCompleted should throw for negative units', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 100);
      expect(() => stage.withUnitsCompleted(-10)).toThrow('Units cannot be negative');
    });

    it('withUnitsCompleted should throw when exceeding started', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1, 100);
      expect(() => stage.withUnitsCompleted(150)).toThrow('Completed units cannot exceed started units');
    });

    it('withCompletionPercentage should update percentage', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      const updated = stage.withCompletionPercentage(75);
      
      expect(updated.completionPercentage).toBe(75);
    });

    it('withCompletionPercentage should throw for invalid percentage', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      expect(() => stage.withCompletionPercentage(-10)).toThrow('Completion percentage must be between 0 and 100');
      expect(() => stage.withCompletionPercentage(110)).toThrow('Completion percentage must be between 0 and 100');
    });

    it('withAccumulatedCost should update cost', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      const updated = stage.withAccumulatedCost(5000);
      
      expect(updated.accumulatedCost.amount).toBe(5000);
    });

    it('addCost should add to existing cost', () => {
      const stage = ProcessStage.create('stage-1', 'Test', 1);
      const updated = stage.withAccumulatedCost(1000).addCost(500);
      
      expect(updated.accumulatedCost.amount).toBe(1500);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const stage = ProcessStage.fromRawData({
        id: 'stage-1', name: 'Mixing', sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 50,
        completionPercentage: 75, accumulatedCost: 1000,
        currency: 'SAR'
      });
      
      const json = stage.toJSON();
      
      expect(json).toEqual({
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100,
        unitsCompleted: 50,
        completionPercentage: 75,
        accumulatedCost: 1000,
        currency: 'SAR'
      });
    });
  });
});

describe('StageStatus Enum', () => {
  it('should have all expected statuses', () => {
    expect(StageStatus.NOT_STARTED).toBe('NOT_STARTED');
    expect(StageStatus.IN_PROGRESS).toBe('IN_PROGRESS');
    expect(StageStatus.COMPLETED).toBe('COMPLETED');
    expect(StageStatus.ON_HOLD).toBe('ON_HOLD');
  });
});
