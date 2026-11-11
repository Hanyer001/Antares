import { clean_session, read_session, store_session } from "./rust-core.js";

export const cleanSession = raw => JSON.parse(clean_session(JSON.stringify(raw ?? null)));
export const readSession = raw => JSON.parse(read_session(JSON.stringify(raw ?? null)));
export const sessionForStorage = (state, savedAt) => JSON.parse(store_session(JSON.stringify(state), savedAt));
