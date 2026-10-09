import type { EverOnnWorkspace } from "@/features/everonn/types";
export type ActionLinks = { booking?: string; chat?: string; voice?: string };
export type WaasSite = EverOnnWorkspace & { actions: ActionLinks; revision: string };
