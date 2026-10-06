import "server-only";
import { requireActor } from "@/features/auth/session";

export const requireProjectReader = () => requireActor("workspace:view");
export const requireProjectManager = () => requireActor("business:configure");
