"use client";
import { useEffect } from "react";

export function applyTheme(t: string) {
  const light = t === "light" || (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("light", light);
}
export function ThemeApplier() {
  useEffect(() => { try { applyTheme(localStorage.getItem("rgk-theme") ?? "dark"); } catch { /* storage unavailable */ } }, []);
  return null;
}
