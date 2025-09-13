import React, { useState } from 'react';

const TestComponent: React.FC = () => {
  const [count, setCount] = useState(0);
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column',
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      backgroundColor: '#f0f0f0',
      direction: 'rtl',
      textAlign: 'center'
    }}>
      <h1 style={{ color: '#333', marginBottom: '20px' }}>Wardah ERP Test Component</h1>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        If you can see this page, React is working correctly!
      </p>
      <div style={{ marginBottom: '20px' }}>
        <button 
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            margin: '0 10px'
          }}
          onClick={() => setCount(count + 1)}
        >
          Count: {count}
        </button>
        <button 
          style={{
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            margin: '0 10px'
          }}
          onClick={() => setCount(0)}
        >
          Reset
        </button>
      </div>
      <p style={{ color: '#888' }}>
        This is a simple test component to verify that the React application is working correctly.
      </p>
    </div>
  );
};

export default TestComponent;