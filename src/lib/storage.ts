// Web storage can be missing or throw (private windows, blocked storage); the board works without it.
function safe(store: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return store().getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string) {
      try {
        store().setItem(key, value)
      } catch {
        // ignore
      }
    },
    remove(key: string) {
      try {
        store().removeItem(key)
      } catch {
        // ignore
      }
    },
  }
}

/** Kept until signing out ("stay signed in"). */
export const storage = safe(() => localStorage)
/** Gone when the tab closes. */
export const sessionStore = safe(() => sessionStorage)
