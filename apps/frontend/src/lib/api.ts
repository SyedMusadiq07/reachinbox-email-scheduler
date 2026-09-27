import axios from 'axios';

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL,
  withCredentials: true, // Crucial for sending/receiving HTTP-only cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
