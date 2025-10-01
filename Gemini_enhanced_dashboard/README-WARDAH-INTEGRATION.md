# Wardah ERP Integration for Financial Dashboard

This document explains how to integrate the Gemini AI Enhanced Financial Dashboard with Wardah (وردة) ERP system.

## Architecture Overview

The integration uses a secure proxy pattern to prevent exposing API keys in client-side code:

```
[Dashboard Frontend] ↔ [Wardah Proxy Service] ↔ [Wardah ERP API]
```

## Backend Proxy Service Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure the environment variables in `.env`:
- `WARDAH_API_KEY`: Your Wardah ERP API key
- `PROXY_AUTH_KEY`: Generate a secure key for proxy authentication
- `PORT`: Port to run the proxy service (default: 3001)

4. Start the proxy service:
```bash
npm start
```

## Frontend Configuration

Update the Wardah proxy configuration in the dashboard HTML file:

```javascript
this.wardahProxyConfig = {
    proxyUrl: '/api/wardah', // URL to your proxy service
    proxyAuthKey: 'your_proxy_auth_key_here' // Same as PROXY_AUTH_KEY in .env
};
```

## Integration Features

1. **Financial Data Sync**: Automatically fetches financial data from Wardah ERP
2. **Real-time Updates**: Syncs with Wardah on demand or scheduled intervals
3. **Data Mapping**: Converts Wardah data structure to dashboard format
4. **Error Handling**: Graceful fallback to default data if sync fails

## API Endpoints

The proxy service provides these endpoints:

- `GET /api/wardah/financial-data` - Financial summary data
- `GET /api/wardah/transactions` - Transaction details
- `GET /api/wardah/inventory` - Inventory summary

## Security Considerations

1. API keys are stored server-side only
2. Proxy authentication prevents unauthorized access
3. CORS is configured to allow only trusted origins
4. All communication should use HTTPS in production

## Usage

To enable Wardah integration, add `?wardah=true` parameter to the dashboard URL:
```
file:///path/to/gemini_enhanced_dashboard.html?wardah=true
```

Or use the "Sync with Wardah ERP" button in the dashboard interface.

## Troubleshooting

1. **Connection errors**: Verify Wardah API key and proxy service is running
2. **Data mapping issues**: Check Wardah data structure matches expected format
3. **Authentication failures**: Ensure PROXY_AUTH_KEY matches between frontend and backend

## Customization

To adapt to different Wardah ERP configurations:

1. Modify `mapWardahDataToDashboardFormat()` method for different data structures
2. Update endpoint URLs in `WARDHAH_CONFIG` if using a different Wardah instance
3. Add new endpoints in the proxy service for additional Wardah features