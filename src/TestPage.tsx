import { useState, useEffect } from 'react'

export default function TestPage() {
  const [count, setCount] = useState(0)
  
  useEffect(() => {
    console.log('🔄 Rendering TestPage component')
  }, [])
  
  const handleClick = () => {
    console.log('Button clicked, count:', count + 1)
    setCount(count + 1)
  }
  
  return (
    <div style={{ padding: '20px', textAlign: 'center', direction: 'rtl' }}>
      <h1>Test Page</h1>
      <p>This is a simple test page to verify React is working.</p>
      <div>
        <button onClick={handleClick}>
          Count: {count}
        </button>
      </div>
      <div style={{ marginTop: '20px', color: 'green' }}>
        <p>If you can see this page and the button works, React is functioning correctly!</p>
      </div>
    </div>
  )
}