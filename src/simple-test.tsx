import { createRoot } from 'react-dom/client';

// Simple component
const SimpleComponent = () => {
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      backgroundColor: '#f0f0f0',
      direction: 'rtl',
      textAlign: 'center'
    }}>
      <div>
        <h1 style={{ color: '#333', marginBottom: '20px' }}>Simple Test Component</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          If you can see this, React is working!
        </p>
      </div>
    </div>
  );
};

// Render the component
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SimpleComponent />);
}