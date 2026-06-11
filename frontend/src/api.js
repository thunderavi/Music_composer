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
    if (detail && typeof detail === "object") {
      const message = detail.message || detail.msg;
      const warnings = Array.isArray(detail.warnings) ? detail.warnings : [];
      if (message && warnings.length) return `${message}\n${warnings.join("\n")}`;
      if (message) return message;
      if (warnings.length) return warnings.join("\n");
    }
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

export async function logoutUser(token) {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: authHeaders(token)
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

export async function composeSong(token, input, onProgress) {
  const body = {
    ...input,
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.substring(6);
        try {
          const data = JSON.parse(jsonStr);
          if (data.error) {
            throw new Error(data.error);
          }
          if (data.type === "complete") {
            return data;
          } else if (data.type === "progress" && onProgress) {
            onProgress(data);
          }
        } catch (err) {
          if (err.message && err.message !== "Unexpected end of JSON input" && err.message !== "Unexpected token") {
             throw err; // Real error from server
          }
          console.error("Failed to parse SSE line:", jsonStr, err);
        }
      }
    }
  }

  throw new Error("Stream closed before completion.");
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
