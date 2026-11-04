import axios from 'axios';

export const api = axios.create({
  // Production build is served by the API itself (same origin), so relative URLs work.
  // Override with VITE_API_URL when the API lives elsewhere.
  baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : ''),
});

export const setAuthToken = (token: string | null) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};
