/**
 * Create a reactive store with subscriptions
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const subscribers = new Set();
  
  return {
    // Get current state
    get: () => state,
    
    // Update state and notify subscribers
    set: (patch) => {
      const prevState = state;
      state = { ...state, ...patch };
      subscribers.forEach(fn => {
        try {
          fn(state, prevState);
        } catch (error) {
          console.error('Store subscriber error:', error);
        }
      });
    },
    
    // Subscribe to state changes
    subscribe: (fn) => {
      subscribers.add(fn);
      // Return unsubscribe function
      return () => subscribers.delete(fn);
    },
    
    // Reset to initial state
    reset: () => {
      state = { ...initial };
      subscribers.forEach(fn => fn(state));
    }
  };
}

// Module-specific stores
export const processCostingStore = createStore({
  activeMO: null,
  lastCalculation: null,
  currentStage: null,
  isCalculating: false
});

export const inventoryStore = createStore({
  selectedItem: null,
  items: [],
  stockMovements: [],
  isLoading: false
});

export const purchasingStore = createStore({
  currentPO: null,
  suppliers: [],
  purchaseOrders: [],
  isLoading: false
});

export const salesStore = createStore({
  currentSO: null,
  customers: [],
  salesOrders: [],
  isLoading: false
});

// Global application store
export const appStore = createStore({
  user: null,
  connectionStatus: 'disconnected',
  notifications: [],
  sidebarCollapsed: false
});