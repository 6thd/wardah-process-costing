// Emergency Fallback App for White Page Debugging
import React, { useState, useEffect } from 'react'

function EmergencyApp() {
  const [debugInfo, setDebugInfo] = useState({
    react: false,
    dom: false,
    router: false,
    auth: false,
    layout: false,
    error: null as null | string  // Fix: Allow error to be string or null
  })

  useEffect(() => {
    // Test React rendering
    setDebugInfo(prev => ({ ...prev, react: true }))
    
    // Test DOM access
    try {
      document.title = 'Wardah ERP - Debug Mode'
      setDebugInfo(prev => ({ ...prev, dom: true }))
    } catch (err) {
      // Fix: Properly handle unknown error type
      const errorMessage = err instanceof Error ? err.message : String(err)
      setDebugInfo(prev => ({ ...prev, error: `DOM Error: ${errorMessage}` }))
    }

    // Test basic imports
    try {
      console.log('🔧 Emergency Debug App loaded')
      const win = globalThis.window;
      if (win) {
        console.log('📍 Current URL:', win.location.href)
        console.log('🌐 User Agent:', win.navigator.userAgent)
        console.log('📱 Screen:', win.screen.width + 'x' + win.screen.height)
      }
    } catch (err) {
      // Fix: Properly handle unknown error type
      const errorMessage = err instanceof Error ? err.message : String(err)
      setDebugInfo(prev => ({ ...prev, error: `Console Error: ${errorMessage}` }))
    }
  }, [])

  const testStep = async (step: string) => {
    console.log(`🧪 Testing: ${step}`)
    
    try {
      switch (step) {
        case 'router': {
          // Fixed: Import and use React Router to eliminate TS6133 warning
          await import('react-router-dom')
          setDebugInfo(prev => ({ ...prev, router: true }))
          console.log('✅ React Router import successful')
          break
        }
          
        case 'auth': {
          // Fixed: Import and use auth store to eliminate TS6133 warning
          const authModule = await import('./store/safe-auth-store')
          // Using the imported module to confirm it works
          console.log('Auth store imported:', !!authModule.useSafeAuthStore)
          setDebugInfo(prev => ({ ...prev, auth: true }))
          console.log('✅ Auth store import successful')
          break
        }
          
        case 'layout': {
          // Fixed: Import and use layout to eliminate TS6133 warning
          const layoutModule = await import('./components/layout/main-layout')
          // Using the imported module to confirm it works
          console.log('Layout imported:', !!layoutModule.MainLayout)
          setDebugInfo(prev => ({ ...prev, layout: true }))
          console.log('✅ Layout import successful')
          break
        }
      }
    } catch (error) {
      // Fix: Properly handle unknown error type
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`❌ ${step} test failed:`, error)
      setDebugInfo(prev => ({ ...prev, error: `${step}: ${errorMessage}` }))
    }
  }

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '20px'
    },
    card: {
      background: 'rgba(255, 255, 255, 0.1)',
      padding: '30px',
      borderRadius: '12px',
      textAlign: 'center' as const,
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      maxWidth: '700px',
      width: '100%',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
    },
    button: {
      background: '#4CAF50',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      margin: '5px',
      transition: 'all 0.3s',
      fontWeight: 'bold'
    },
    errorButton: {
      background: '#f44336',
      color: 'white',
      border: 'none',
      padding: '12px 24px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      margin: '5px'
    },
    status: {
      padding: '15px',
      background: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '8px',
      margin: '15px 0',
      textAlign: 'left' as const,
      fontSize: '14px'
    },
    success: { color: '#4CAF50', fontWeight: 'bold' },
    error: { color: '#f44336', fontWeight: 'bold' },
    pending: { color: '#FFC107', fontWeight: 'bold' }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1>🚨 Wardah ERP - Emergency Debug Mode</h1>
        <p>Deep diagnostic system for white page issues</p>
        
        <div style={styles.status}>
          <h3>🔍 System Status:</h3>
          <div>React Rendering: <span style={debugInfo.react ? styles.success : styles.pending}>
            {debugInfo.react ? '✅ Working' : '⏳ Testing...'}
          </span></div>
          
          <div>DOM Access: <span style={debugInfo.dom ? styles.success : styles.pending}>
            {debugInfo.dom ? '✅ Working' : '⏳ Testing...'}
          </span></div>
          
          <div>React Router: <span style={debugInfo.router ? styles.success : styles.pending}>
            {debugInfo.router ? '✅ Working' : '❓ Not Tested'}
          </span></div>
          
          <div>Auth Store: <span style={debugInfo.auth ? styles.success : styles.pending}>
            {debugInfo.auth ? '✅ Working' : '❓ Not Tested'}
          </span></div>
          
          <div>Layout System: <span style={debugInfo.layout ? styles.success : styles.pending}>
            {debugInfo.layout ? '✅ Working' : '❓ Not Tested'}
          </span></div>
          
          {debugInfo.error && (
            <div style={styles.error}>
              Error: {debugInfo.error}
            </div>
          )}
        </div>
        
        <div>
          <h3>🧪 Progressive Tests:</h3>
          <button style={styles.button} onClick={() => testStep('router')}>
            Test React Router
          </button>
          <button style={styles.button} onClick={() => testStep('auth')}>
            Test Auth Store
          </button>
          <button style={styles.button} onClick={() => testStep('layout')}>
            Test Layout Components
          </button>
          
          <br />
          
          <button 
            style={styles.errorButton}
            onClick={() => {
              console.error('🚨 Simulated error for console testing')
              throw new Error('Manual error test - Check console')
            }}
          >
            Trigger Error
          </button>
          
          <button 
            style={styles.button}
            onClick={() => {
              console.log('🔄 Reloading page...')
              globalThis.window?.location.reload()
            }}
          >
            Reload Page
          </button>
        </div>
        
        <div style={{ marginTop: '20px', fontSize: '12px', opacity: 0.8 }}>
          <strong>Environment Info:</strong><br/>
          URL: {globalThis.window?.location.href || 'N/A'}<br/>
          Time: {new Date().toLocaleString()}<br/>
          Mode: {import.meta.env.MODE}<br/>
          React: {React.version || 'Unknown'}
        </div>
      </div>
    </div>
  )
}

export default EmergencyApp