import axios from 'axios';

// Create Axios instance pointing to our own Next.js API Proxy
const api = axios.create({
  baseURL: '/api', // Relative path to Next.js API Routes
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
