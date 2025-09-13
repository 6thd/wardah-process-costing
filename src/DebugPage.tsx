import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useUIStore } from '@/store/ui-store'

export default function DebugPage() {
  const { isAuthenticated, isLoading, user, error } = useAuthStore()
  const { isInitialized, theme, language } = useUIStore()
  const [debugInfo, setDebugInfo] = useState<any>({})
  
  useEffect(() => {
    console.log('🔄 DebugPage mounted')
    
    // Log all relevant state
    console.log('Auth State:', { isAuthenticated, isLoading, user, error })
    console.log('UI State:', { isInitialized, theme, language })
    
    // Set debug info
    setDebugInfo({
      auth: { isAuthenticated, isLoading, user, error },
      ui: { isInitialized, theme, language },
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      online: navigator.onLine
    })
    
    // Check if required DOM elements exist
    console.log('Root element exists:', !!document.getElementById('root'))
    console.log('Document direction:', document.documentElement.dir)
    console.log('Document language:', document.documentElement.lang)
  }, [isAuthenticated, isLoading, user, error, isInitialized, theme, language])
  
  return (
    <div style={{ padding: '20px', direction: 'rtl', textAlign: 'right' }}>
      <h1>Debug Page</h1>
      <p>This page helps diagnose issues with the Wardah ERP application.</p>
      
      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '5px' }}>
        <h2>Application State</h2>
        <pre style={{ textAlign: 'left', backgroundColor: 'white', padding: '10px', borderRadius: '3px', overflow: 'auto' }}>
          {JSON.stringify(debugInfo, null, 2)}
        </pre>
      </div>
      
      <div style={{ marginTop: '20px' }}>
        <h2>Troubleshooting Steps</h2>
        <ol>
          <li>Check the browser console for any error messages</li>
          <li>Verify that all required files are loading (check Network tab)</li>
          <li>Try clearing browser cache and refreshing the page</li>
          <li>Check if the development server is running without errors</li>
        </ol>
      </div>
      
      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#e0f0ff', borderRadius: '5px' }}>
        <h2>Quick Links</h2>
        <ul>
          <li><a href="/login">Login Page</a></li>
          <li><a href="/test">Test Page</a></li>
          <li><a href="/">Dashboard (requires authentication)</a></li>
        </ul>
      </div>
    </div>
  )
}