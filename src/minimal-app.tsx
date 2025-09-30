import { createRoot } from 'react-dom/client';

const App = () => {
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
                                                                  <h1 style={{ color: '#333', marginBottom: '20px' }}>Minimal React App</h1>
                                                                          <p style={{ color: '#666', marginBottom: '20px' }}>
                                                                                    If you can see this page, React is working correctly!
                                                                                            </p>
                                                                                                    <button 
                                                                                                              style={{
                                                                                                                          padding: '10px 20px',
                                                                                                                                      backgroundColor: '#007bff',
                                                                                                                                                  color: 'white',
                                                                                                                                                              border: 'none',
                                                                                                                                                                          borderRadius: '5px',
                                                                                                                                                                                      cursor: 'pointer'
                                                                                                                                                                                                }}
                                                                                                                                                                                                          onClick={() => alert('Button clicked!')}
                                                                                                                                                                                                                  >
                                                                                                                                                                                                                            Click Me
                                                                                                                                                                                                                                    </button>
                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                              </div>
                                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                                };

                                                                                                                                                                                                                                                // Render the app
                                                                                                                                                                                                                                                const rootElement = document.getElementById('root');
                                                                                                                                                                                                                                                if (rootElement) {
                                                                                                                                                                                                                                                  const root = createRoot(rootElement);
                                                                                                                                                                                                                                                    root.render(<App />);
                                                                                                                                                                                                                                                    }