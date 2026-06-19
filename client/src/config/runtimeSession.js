function resolveBlackboardWriteAccess(params, roleValue) {
  const mode = (params.get("classroomMode") || params.get("entry") || "").toLowerCase();
  const access = (params.get("blackboardAccess") || "").toLowerCase();
  const explicitCanWrite = params.get("canWriteBlackboard");

  if (explicitCanWrite !== null) {
    return explicitCanWrite === "true";
  }

  if (access === "creator" || access === "write") {
    return true;
  }

  if (mode === "created" || mode === "create" || mode === "host") {
    return true;
  }

  // Fallback keeps current behavior for teacher role while dashboard wiring is in progress.
  return roleValue === "teacher";
}

export function createRuntimeSession(searchParams) {
  const paramRole = String(searchParams.get("role") || "").toLowerCase();
  const storedRole = String(localStorage.getItem("delta-user-role") || "").toLowerCase();
  const role = paramRole === "teacher" ? "teacher" : storedRole === "teacher" ? "teacher" : "student";
  const canWriteBlackboard = resolveBlackboardWriteAccess(searchParams, role);

  return {
    role,
    canWriteBlackboard,
  };
}