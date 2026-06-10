const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5050/api/v1";

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseError(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    const detail = payload.detail ?? payload.message;
    if (Array.isArray(detail)) {
      // FastAPI 422 validation errors: [{loc, msg, type}, ...]
      return detail.map((d) => `${d.loc?.slice(1).join(" → ") ?? "field"}: ${d.msg}`).join("\n");
    }
    if (typeof detail === "string") return detail;
    return JSON.stringify(payload);
  }
  return response.text();
}

export async function registerUser(input) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function loginUser(input) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function getCurrentUser(token) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: authHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function listWorkspaces(token) {
  const response = await fetch(`${API_BASE_URL}/workspaces`, {
    headers: authHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function createWorkspace(token, name) {
  const response = await fetch(`${API_BASE_URL}/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function listProjects(token, workspaceId) {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/projects`, {
    headers: authHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function createProject(token, workspaceId, title) {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title })
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function updateProject(token, projectId, payload) {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function getProvider() {
  const response = await fetch(`${API_BASE_URL}/provider`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function composeSong(token, input) {
  const body = {
    ...input,
    // Convert empty string to null so FastAPI Optional[str] validates correctly
    custom_lyrics: input.custom_lyrics?.trim() || null
  };
  const response = await fetch(`${API_BASE_URL}/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function refineSong(token, target, composition, instructions = "") {
  const response = await fetch(`${API_BASE_URL}/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
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

export async function saveDraft(token, draftId, composition) {
  const response = await fetch(`${API_BASE_URL}/drafts/${draftId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function createDraft(token, composition) {
  const response = await fetch(`${API_BASE_URL}/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(composition)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function listDrafts(token) {
  const response = await fetch(`${API_BASE_URL}/drafts`, {
    headers: authHeaders(token)
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json();
}

export async function getDraft(token, draftId) {
  const response = await fetch(`${API_BASE_URL}/drafts/${draftId}`, {
    headers: authHeaders(token)
  });
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
