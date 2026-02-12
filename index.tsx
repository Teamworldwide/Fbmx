
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const mountApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error("Critical Error: Root element not found");
    return;
  }

  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Mounting Error:", error);
    rootElement.innerHTML = `
      <div style="padding: 20px; color: white; background: #991b1b; text-align: center; font-family: sans-serif;">
        <h1 style="margin-bottom: 10px;">Application Error</h1>
        <p>There was an error loading the FBMX Dashboard.</p>
        <button onclick="window.location.reload()" style="margin-top: 15px; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;">
          Try Reloading
        </button>
      </div>
    `;
  }
};

// Ensure DOM is fully ready before mounting
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}
