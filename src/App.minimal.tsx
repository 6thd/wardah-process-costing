// Super minimal app for basic testing
function MinimalApp() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#007acc',
      color: 'white',
      fontSize: '24px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        padding: '40px',
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: '8px',
        textAlign: 'center'
      }}>
        <h1>✅ React is Working!</h1>
        <p>If you can see this, React rendering is successful</p>
        <p>Time: {new Date().toLocaleString()}</p>
        <button 
          onClick={() => alert('React events working!')}
          style={{
            padding: '10px 20px',
            background: 'white',
            color: '#007acc',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginTop: '20px'
          }}
        >
          Test Click
        </button>
      </div>
    </div>
  )
}

export default MinimalApp