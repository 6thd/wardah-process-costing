import { Router } from 'express';
import { GeminiDashboard } from '../components/dashboard';
import { render } from '@react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import React from 'react';

export const router = Router();

router.get('/dashboard', (req, res) => {
  try {
    const html = render.renderToString(
      React.createElement(StaticRouter, { location: req.url },
        React.createElement(GeminiDashboard)
      )
    );
    
    res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>لوحة معلومات Gemini</title>
          <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
          <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
          <script src="https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
          <link rel="stylesheet" href="/styles/dashboard.css">
        </head>
        <body>
          <div id="root">${html}</div>
          <script src="/js/dashboard.bundle.js"></script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('خطأ في تقديم الصفحة:', error);
    res.status(500).send('خطأ في تحميل لوحة المعلومات');
  }
});