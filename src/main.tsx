
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './globals.css'; // Restored and corrected the path to the global stylesheet
import './i18n.ts'; // Internationalization

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error('Failed to find the root element. The application cannot be mounted.');
}
