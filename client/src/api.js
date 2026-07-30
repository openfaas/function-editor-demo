export async function apiFetch(url, options) {
  const response = await fetch(url, options);

  if (response.status === 401) {
    window.dispatchEvent(new Event('auth-required'));
  }

  return response;
}
