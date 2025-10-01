// Wardah ERP Proxy Service
// This backend service securely handles API calls to Wardah ERP
// and prevents exposing API keys in client-side code

const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Wardah ERP Configuration
const WARDHAH_CONFIG = {
    baseUrl: 'https://api.wardah-erp.com/v1',
    apiKey: process.env.WARDAH_API_KEY // Store API key in environment variables
};

// Middleware to validate API key
const authenticate = (req, res, next) => {
    const authKey = req.headers['x-api-key'];
    if (!authKey || authKey !== process.env.PROXY_AUTH_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Proxy endpoint for financial data
app.get('/api/wardah/financial-data', authenticate, async (req, res) => {
    try {
        const response = await axios.get(`${WARDHAH_CONFIG.baseUrl}/financial/data`, {
            headers: {
                'Authorization': `Bearer ${WARDHAH_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Wardah API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch data from Wardah ERP' });
    }
});

// Proxy endpoint for transactions
app.get('/api/wardah/transactions', authenticate, async (req, res) => {
    try {
        const response = await axios.get(`${WARDHAH_CONFIG.baseUrl}/transactions`, {
            headers: {
                'Authorization': `Bearer ${WARDHAH_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Wardah API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch transactions from Wardah ERP' });
    }
});

// Proxy endpoint for inventory data
app.get('/api/wardah/inventory', authenticate, async (req, res) => {
    try {
        const response = await axios.get(`${WARDHAH_CONFIG.baseUrl}/inventory/summary`, {
            headers: {
                'Authorization': `Bearer ${WARDHAH_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Wardah API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch inventory data from Wardah ERP' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'Wardah ERP Proxy' });
});

app.listen(PORT, () => {
    console.log(`Wardah ERP Proxy Service running on port ${PORT}`);
});