// Simple test page to debug white page issue

export function TestPage() {
  console.log('TestPage component rendered')
  
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🧪 Test Page</h1>
      <p>If you can see this, React is working properly!</p>
      <div>
        <h2>Debug Info:</h2>
        <ul>
          <li>React: ✅ Working</li>
          <li>Rendering: ✅ Working</li>
          <li>Time: {new Date().toLocaleString()}</li>
        </ul>
      </div>
    </div>
  )
}