function sessionMenuKey(session) {
    return String(session.pet_session_id || session.codex_session_id || "");
}
export function indexPetMenuSessions(sessions) {
    const index = new Map();
    for (const session of sessions) {
        const petSessionId = String(session.pet_session_id || "");
        const codexSessionId = String(session.codex_session_id || "");
        const primaryKey = sessionMenuKey(session);
        if (primaryKey)
            index.set(primaryKey, session);
        if (petSessionId)
            index.set(petSessionId, session);
        if (codexSessionId)
            index.set(codexSessionId, session);
    }
    return index;
}
