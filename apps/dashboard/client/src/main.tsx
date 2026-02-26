import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { BugReportProvider } from './contexts/BugReportContext';
import { ToastProvider } from './components/Toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <BugReportProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BugReportProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
