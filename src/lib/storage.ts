// localStorage can be missing or throw (private windows, blocked storage); the board works without it.
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}
