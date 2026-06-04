const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5050/api/v1";

async function parseError(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return payload.detail || payload.message || JSON.stringify(payload);
  }
  return response.text();
}

export async function getProvider() {
  const response = await fetch(`${API_BASE_URL}/provider`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function composeSong(input) {
  const response = await fetch(`${API_BASE_URL}/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function refineSong(target, composition, instructions = "") {
  const response = await fetch(`${API_BASE_URL}/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, composition, instructions })
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function validateComposition(composition) {
  const response = await fetch(`${API_BASE_URL}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function evaluateComposition(composition) {
  const response = await fetch(`${API_BASE_URL}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function reviewCommercialReadiness(composition) {
  const response = await fetch(`${API_BASE_URL}/commercial-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function saveDraft(draftId, composition) {
  const response = await fetch(`${API_BASE_URL}/drafts/${draftId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function listDrafts() {
  const response = await fetch(`${API_BASE_URL}/drafts`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function getDraft(draftId) {
  const response = await fetch(`${API_BASE_URL}/drafts/${draftId}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

async function fetchExport(path, composition, fallbackName) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackName;
  return { blob, filename };
}

export async function exportCompositionBlob(path, composition, fallbackName) {
  return fetchExport(path, composition, fallbackName);
}

export async function downloadExport(path, composition, fallbackName) {
  const { blob, filename } = await fetchExport(path, composition, fallbackName);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
