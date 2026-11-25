import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createDataSource } from './data';
import './index.css';

const source = createDataSource();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
);
