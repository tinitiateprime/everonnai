import type { Artifact, DesignPlan, Discovery, Knowledge } from "./types";
export type Draft = {
  knowledge: Knowledge;
  discovery: Discovery | null;
  artifacts: Artifact[];
  plan: DesignPlan | null;
  generatedFrom: string;
  version: 1;
};
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("everonn-website-studio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readDraft(): Promise<Draft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("drafts")
        .objectStore("drafts")
        .get("current");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveDraft(draft: Draft) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(draft, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
