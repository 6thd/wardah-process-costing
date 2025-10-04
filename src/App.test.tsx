// Super simple test to isolate the issue
import { BrowserRouter } from 'react-router-dom'

function TestApp() {
  console.log('🧪 TestApp is rendering')
  
  try {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f0f0',
        color: '#333',
        fontSize: '18px',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{
          padding: '30px',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <h1>🧪 Test App Loaded Successfully</h1>
          <p>Time: {new Date().toLocaleString()}</p>
          <p>Router works: ✅</p>
          <p>React rendering: ✅</p>
          
          <button 
            onClick={() => console.log('Button clicked!')}
            style={{
              padding: '10px 20px',
              background: '#007acc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginTop: '20px'
            }}
          >
            Test Console Log
          </button>
        </div>
      </div>
    )
  } catch (error) {
    console.error('❌ TestApp render error:', error)
    return (
      <div style={{background: 'red', color: 'white', padding: '20px'}}>
        <h1>❌ Test App Failed</h1>
        <p>Error: {error.message}</p>
      </div>
    )
  }
}

export default function WrappedTestApp() {
  console.log('🚀 WrappedTestApp starting...')
  
  try {
    return (
      <BrowserRouter>
        <TestApp />
      </BrowserRouter>
    )
  } catch (error) {
    console.error('❌ WrappedTestApp error:', error)
    return (
      <div style={{background: 'darkred', color: 'white', padding: '20px'}}>
        <h1>❌ Router Failed</h1>
        <p>Error: {error.message}</p>
      </div>
    )
  }
}