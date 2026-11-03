export function reloadPage(): void {
  window.location.reload();
}

/** A full navigation, so the dashboard shell reloads its teams and context. */
export function navigateTo(path: string): void {
  window.location.assign(path);
}
