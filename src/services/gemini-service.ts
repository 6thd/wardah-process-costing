// Service to integrate with Gemini Dashboard Proxy
import { getConfig } from '@/lib/config'

// Gemini Service class
class GeminiService {
  private proxyUrl: string
  private proxyAuthKey: string

  constructor() {
    // Get configuration from the config system
    const config = getConfig()
    this.proxyUrl = config?.GEMINI_DASHBOARD?.proxy_url || 'http://localhost:3001/api/wardah'
    this.proxyAuthKey = config?.GEMINI_DASHBOARD?.proxy_auth_key || ''
  }

  // Check if the service is configured
  isConfigured(): boolean {
    return !!this.proxyAuthKey
  }

  // Initialize the Gemini dashboard integration
  initializeIntegration() {
    // This method would be used to initialize any integration logic
    console.log('Initializing Gemini Dashboard integration...')
  }

  // Send a message to the iframe dashboard (using same origin for security)
  sendMessageToDashboard(message: any) {
    const iframe = document.getElementById('gemini-dashboard-iframe') as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      // Use window.location.origin instead of '*' for security
      iframe.contentWindow.postMessage(message, window.location.origin)
    }
  }

  // Listen for messages from the iframe dashboard (verify origin for security)
  listenForMessages(callback: (message: any) => void) {
    const handler = (event: MessageEvent) => {
      // Verify the message is from same origin
      if (event.origin !== window.location.origin) {
        console.warn('Ignoring message from unauthorized origin:', event.origin)
        return
      }
      
      // Verify the message is from our dashboard iframe
      const iframe = document.getElementById('gemini-dashboard-iframe') as HTMLIFrameElement | null
      if (iframe && event.source === iframe.contentWindow) {
        callback(event.data)
      }
    }
    
    window.addEventListener('message', handler)
    
    // Return a function to remove the listener
    return () => window.removeEventListener('message', handler)
  }

  // Sync all data from Wardah ERP through the proxy
  async syncAllData(): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('Gemini service is not properly configured')
    }

    try {
      // Fetch financial data
      const financialResponse = await fetch(`${this.proxyUrl}/financial-data`, {
        headers: {
          'x-api-key': this.proxyAuthKey,
          'Content-Type': 'application/json'
        }
      })

      if (!financialResponse.ok) {
        throw new Error(`Failed to fetch financial data: ${financialResponse.statusText}`)
      }

      const financialData = await financialResponse.json()

      // Fetch inventory data
      const inventoryResponse = await fetch(`${this.proxyUrl}/inventory`, {
        headers: {
          'x-api-key': this.proxyAuthKey,
          'Content-Type': 'application/json'
        }
      })

      if (!inventoryResponse.ok) {
        throw new Error(`Failed to fetch inventory data: ${inventoryResponse.statusText}`)
      }

      const inventoryData = await inventoryResponse.json()

      // Combine all data
      return {
        financialData,
        inventoryData,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error('Error syncing data with Wardah ERP:', error)
      throw error
    }
  }
}

// Export singleton instance
export const geminiService = new GeminiService()