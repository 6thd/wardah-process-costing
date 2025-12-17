import { describe, it, expect } from 'vitest';
import { ProcessStage, StageStatus } from '../entities/ProcessStage';

describe('ProcessStage Entity', () => {
  describe('creation', () => {
    it('should create ProcessStage with valid data', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1, 100);
      
      expect(stage.id).toBe('stage-1');
      expect(stage.name).toBe('Mixing');
      expect(stage.sequence).toBe(1);
      expect(stage.status).toBe(StageStatus.NOT_STARTED);
      expect(stage.unitsStarted.value).toBe(100);
    });

    it('should create with default units and currency', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1);
      
      expect(stage.unitsStarted.value).toBe(0);
      expect(stage.accumulatedCost.currency).toBe('SAR');
    });

    it('should throw for invalid sequence', () => {
      expect(() => ProcessStage.create('stage-1', 'Mixing', 0)).toThrow('Sequence must be at least 1');
      expect(() => ProcessStage.create('stage-1', 'Mixing', -1)).toThrow('Sequence must be at least 1');
    });

    it('should create from raw data', () => {
      const data = {
        id: 'stage-2',
        name: 'Filling',
        sequence: 2,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 500,
        unitsCompleted: 200,
        completionPercentage: 60,
        accumulatedCost: 10000,
        currency: 'SAR'
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.id).toBe('stage-2');
      expect(stage.name).toBe('Filling');
      expect(stage.status).toBe(StageStatus.IN_PROGRESS);
      expect(stage.unitsStarted.value).toBe(500);
      expect(stage.unitsCompleted.value).toBe(200);
      expect(stage.completionPercentage).toBe(60);
      expect(stage.accumulatedCost.amount).toBe(10000);
    });
  });

  describe('unitsInProgress', () => {
    it('should calculate units in progress', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 400,
        completionPercentage: 50,
        accumulatedCost: 5000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.unitsInProgress.value).toBe(600);
    });

    it('should return zero when all units completed', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.COMPLETED,
        unitsStarted: 1000,
        unitsCompleted: 1000,
        completionPercentage: 100,
        accumulatedCost: 5000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.unitsInProgress.value).toBe(0);
    });
  });

  describe('wipPercentage', () => {
    it('should calculate WIP percentage', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 200,
        completionPercentage: 50,
        accumulatedCost: 5000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.wipPercentage).toBe(80); // 800/1000 = 80%
    });

    it('should return zero when no units started', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1, 0);
      
      expect(stage.wipPercentage).toBe(0);
    });
  });

  describe('equivalentUnits', () => {
    it('should calculate equivalent units', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 400,
        completionPercentage: 50,
        accumulatedCost: 10000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      // 400 completed + (600 in progress * 50% completion) = 400 + 300 = 700
      expect(stage.equivalentUnits).toBe(700);
    });

    it('should equal total units when 100% complete', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.COMPLETED,
        unitsStarted: 1000,
        unitsCompleted: 1000,
        completionPercentage: 100,
        accumulatedCost: 10000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.equivalentUnits).toBe(1000);
    });
  });

  describe('costPerEquivalentUnit', () => {
    it('should calculate cost per equivalent unit', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 400,
        completionPercentage: 50,
        accumulatedCost: 7000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      // 7000 / 700 equivalent units = 10
      expect(stage.costPerEquivalentUnit.amount).toBe(10);
    });

    it('should return zero when no equivalent units', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.NOT_STARTED,
        unitsStarted: 0,
        unitsCompleted: 0,
        completionPercentage: 0,
        accumulatedCost: 0
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      expect(stage.costPerEquivalentUnit.amount).toBe(0);
    });
  });

  describe('totalWIP', () => {
    it('should calculate total WIP value', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 400,
        completionPercentage: 50,
        accumulatedCost: 10000
      };
      
      const stage = ProcessStage.fromRawData(data);
      
      // WIP units = 600 * 50% = 300 equivalent
      // Cost per unit = 10000 / 1000 = 10
      // Total WIP = 300 * 10 = 3000
      expect(stage.totalWIP.amount).toBe(3000);
    });

    it('should return zero when no units started', () => {
      const stage = ProcessStage.create('stage-1', 'Mixing', 1, 0);
      
      expect(stage.totalWIP.amount).toBe(0);
    });
  });

  describe('status transitions', () => {
    describe('start', () => {
      it('should transition from NOT_STARTED to IN_PROGRESS', () => {
        const stage = ProcessStage.create('stage-1', 'Mixing', 1, 100);
        const started = stage.start();
        
        expect(started.status).toBe(StageStatus.IN_PROGRESS);
      });

      it('should transition from ON_HOLD to IN_PROGRESS', () => {
        const data = {
          id: 'stage-1',
          name: 'Mixing',
          sequence: 1,
          status: StageStatus.ON_HOLD,
          unitsStarted: 100,
          unitsCompleted: 0,
          completionPercentage: 0,
          accumulatedCost: 0
        };
        
        const stage = ProcessStage.fromRawData(data);
        const started = stage.start();
        
        expect(started.status).toBe(StageStatus.IN_PROGRESS);
      });

      it('should throw when starting from IN_PROGRESS', () => {
        const data = {
          id: 'stage-1',
          name: 'Mixing',
          sequence: 1,
          status: StageStatus.IN_PROGRESS,
          unitsStarted: 100,
          unitsCompleted: 0,
          completionPercentage: 0,
          accumulatedCost: 0
        };
        
        const stage = ProcessStage.fromRawData(data);
        
        expect(() => stage.start()).toThrow();
      });

      it('should throw when starting from COMPLETED', () => {
        const data = {
          id: 'stage-1',
          name: 'Mixing',
          sequence: 1,
          status: StageStatus.COMPLETED,
          unitsStarted: 100,
          unitsCompleted: 100,
          completionPercentage: 100,
          accumulatedCost: 1000
        };
        
        const stage = ProcessStage.fromRawData(data);
        
        expect(() => stage.start()).toThrow();
      });
    });

    describe('complete', () => {
      it('should transition from IN_PROGRESS to COMPLETED', () => {
        const data = {
          id: 'stage-1',
          name: 'Mixing',
          sequence: 1,
          status: StageStatus.IN_PROGRESS,
          unitsStarted: 100,
          unitsCompleted: 50,
          completionPercentage: 50,
          accumulatedCost: 1000
        };
        
        const stage = ProcessStage.fromRawData(data);
        const completed = stage.complete();
        
        expect(completed.status).toBe(StageStatus.COMPLETED);
        expect(completed.unitsCompleted.value).toBe(100);
        expect(completed.completionPercentage).toBe(100);
      });

      it('should throw when completing from NOT_STARTED', () => {
        const stage = ProcessStage.create('stage-1', 'Mixing', 1, 100);
        
        expect(() => stage.complete()).toThrow();
      });
    });
  });

  describe('StageStatus enum', () => {
    it('should have correct values', () => {
      expect(StageStatus.NOT_STARTED).toBe('NOT_STARTED');
      expect(StageStatus.IN_PROGRESS).toBe('IN_PROGRESS');
      expect(StageStatus.COMPLETED).toBe('COMPLETED');
      expect(StageStatus.ON_HOLD).toBe('ON_HOLD');
    });
  });

  describe('manufacturing scenarios', () => {
    it('should model cosmetics production line stages', () => {
      const mixingStage = ProcessStage.fromRawData({
        id: 'mixing',
        name: 'Mixing & Blending',
        sequence: 1,
        status: StageStatus.COMPLETED,
        unitsStarted: 1000,
        unitsCompleted: 1000,
        completionPercentage: 100,
        accumulatedCost: 5000
      });

      const fillingStage = ProcessStage.fromRawData({
        id: 'filling',
        name: 'Filling',
        sequence: 2,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 1000,
        unitsCompleted: 600,
        completionPercentage: 75,
        accumulatedCost: 8000
      });

      const packagingStage = ProcessStage.fromRawData({
        id: 'packaging',
        name: 'Packaging',
        sequence: 3,
        status: StageStatus.NOT_STARTED,
        unitsStarted: 0,
        unitsCompleted: 0,
        completionPercentage: 0,
        accumulatedCost: 0
      });

      expect(mixingStage.unitsInProgress.value).toBe(0);
      expect(fillingStage.unitsInProgress.value).toBe(400);
      expect(packagingStage.unitsInProgress.value).toBe(0);
    });
  });

  describe('immutability', () => {
    it('should return new instance on start', () => {
      const original = ProcessStage.create('stage-1', 'Mixing', 1, 100);
      const started = original.start();
      
      expect(original.status).toBe(StageStatus.NOT_STARTED);
      expect(started.status).toBe(StageStatus.IN_PROGRESS);
      expect(original).not.toBe(started);
    });

    it('should return new instance on complete', () => {
      const data = {
        id: 'stage-1',
        name: 'Mixing',
        sequence: 1,
        status: StageStatus.IN_PROGRESS,
        unitsStarted: 100,
        unitsCompleted: 50,
        completionPercentage: 50,
        accumulatedCost: 1000
      };
      
      const original = ProcessStage.fromRawData(data);
      const completed = original.complete();
      
      expect(original.status).toBe(StageStatus.IN_PROGRESS);
      expect(completed.status).toBe(StageStatus.COMPLETED);
      expect(original).not.toBe(completed);
    });
  });
});
