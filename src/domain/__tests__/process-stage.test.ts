/**
 * ProcessStage Entity Tests
 */
import { describe, it, expect } from 'vitest';
import { ProcessStage, StageStatus } from '../entities/ProcessStage';

describe('ProcessStage Entity', () => {
  describe('Creation', () => {
    it('should create with valid data', () => {
      const s = ProcessStage.create('STAGE-001', 'Mixing', 1, 100);
      expect(s.id).toBe('STAGE-001');
      expect(s.name).toBe('Mixing');
      expect(s.sequence).toBe(1);
      expect(s.status).toBe(StageStatus.NOT_STARTED);
    });

    it('should throw for invalid sequence', () => {
      expect(() => ProcessStage.create('S1', 'Mix', 0)).toThrow('Sequence must be at least 1');
    });

    it('should create from raw data', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 60,
        accumulatedCost: 5000, currency: 'SAR'
      });
      expect(s.status).toBe(StageStatus.IN_PROGRESS);
      expect(s.completionPercentage).toBe(60);
    });
  });

  describe('WIP Calculations', () => {
    it('should calculate units in progress', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 50, accumulatedCost: 10000
      });
      expect(s.unitsInProgress.value).toBe(60);
    });

    it('should calculate WIP percentage', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 50, accumulatedCost: 10000
      });
      expect(s.wipPercentage).toBe(60);
    });

    it('should calculate equivalent units', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 50, accumulatedCost: 10000
      });
      expect(s.equivalentUnits).toBe(70);
    });

    it('should calculate total WIP', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 50, accumulatedCost: 10000
      });
      expect(s.totalWIP.amount).toBe(3000);
    });
  });

  describe('Status Transitions', () => {
    it('should start from NOT_STARTED', () => {
      const s = ProcessStage.create('S1', 'Mix', 1, 100);
      const started = s.start();
      expect(started.status).toBe(StageStatus.IN_PROGRESS);
    });

    it('should complete from IN_PROGRESS', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 50, completionPercentage: 50, accumulatedCost: 5000
      });
      const completed = s.complete();
      expect(completed.status).toBe(StageStatus.COMPLETED);
      expect(completed.unitsCompleted.value).toBe(100);
    });

    it('should throw when starting from COMPLETED', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.COMPLETED,
        unitsStarted: 100, unitsCompleted: 100, completionPercentage: 100, accumulatedCost: 5000
      });
      expect(() => s.start()).toThrow();
    });
  });

  describe('Immutable Operations', () => {
    it('should add cost immutably', () => {
      const o = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 0, completionPercentage: 0, accumulatedCost: 5000
      });
      const m = o.addCost(2500);
      expect(o.accumulatedCost.amount).toBe(5000);
      expect(m.accumulatedCost.amount).toBe(7500);
    });

    it('should update completion percentage', () => {
      const s = ProcessStage.create('S1', 'Mix', 1, 100);
      const updated = s.withCompletionPercentage(75);
      expect(updated.completionPercentage).toBe(75);
    });

    it('should validate completion percentage range', () => {
      const s = ProcessStage.create('S1', 'Mix', 1, 100);
      expect(() => s.withCompletionPercentage(-10)).toThrow();
      expect(() => s.withCompletionPercentage(150)).toThrow();
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      const s = ProcessStage.fromRawData({
        id: 'S1', name: 'Mix', sequence: 1, status: StageStatus.IN_PROGRESS,
        unitsStarted: 100, unitsCompleted: 40, completionPercentage: 60,
        accumulatedCost: 5000, currency: 'SAR'
      });
      const j = s.toJSON();
      expect(j.id).toBe('S1');
      expect(j.status).toBe(StageStatus.IN_PROGRESS);
    });
  });
});
