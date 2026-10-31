import { supabase } from "./supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export class ApiError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join(" "));
    this.errors = errors;
  }
}

// FastAPI errors come as a string, {errors: [...]}, or a list of {msg}.
function toErrorList(detail: unknown): string[] {
  if (typeof detail === "string") return [detail];
  if (detail && typeof detail === "object" && "errors" in detail) {
    return (detail as { errors: string[] }).errors;
  }
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d));
  return ["Something went wrong. Please try again."];
}

function goToLogin(): never {
  window.location.href = "/login";
  throw new ApiError(["Please log in again."]);
}

// Calls the FastAPI backend with the logged-in user's token.
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) goToLogin();

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(["Could not reach the server. Check your connection and try again."]);
  }

  if (res.status === 401) {
    await supabase.auth.signOut();
    goToLogin();
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(toErrorList(body?.detail));
  return body as T;
}
