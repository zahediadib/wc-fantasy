import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Auth via HttpOnly cookie set by the backend on /auth/login.
// The cookie is same-origin (frontend + backend share the preview hostname),
// so the browser sends it automatically when `withCredentials: true`.
export const api = axios.create({ baseURL: API, withCredentials: true });

export function fmtErr(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err.message || "خطای ناشناخته";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e.msg || JSON.stringify(e)).join(" / ");
  return JSON.stringify(d);
}
