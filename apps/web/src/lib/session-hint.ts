/**
 * "This browser has signed in before." The refresh cookie is HttpOnly, so scripts can't see
 * whether one exists. Without this, every anonymous visit would have to ask the API, waking
 * the free host. It holds nothing secret: a wrong value only costs one extra request.
 */
const KEY = "pulse-has-session";

/** When storage is blocked we can't tell, so we ask the API rather than sign anyone out. */
export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function setSessionHint(present: boolean): void {
  try {
    if (present) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing: hasSessionHint() falls back to asking the API.
  }
}
