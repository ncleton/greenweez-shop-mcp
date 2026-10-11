// Fichier généré par generate.mjs à partir de retailers/greenweez/spec.json. Ne pas modifier ici.
export interface ScopeField { key: string; env: string; description: string; example: string; pattern?: string }
export const RETAILER: {
  id: string; slug: string; version: string; label: string; origin: string; entryUrl: string; loginUrl: string; signupUrl: string;
  platform: string; fulfillment: ReadonlyArray<"delivery" | "click_and_collect">; accountRequired: boolean;
  scopeFields: ReadonlyArray<ScopeField>;
} = {
  "id": "greenweez",
  "slug": "greenweez",
  "version": "0.1.0",
  "label": "Greenweez",
  "origin": "https://www.greenweez.com",
  "entryUrl": "https://www.greenweez.com/",
  "loginUrl": "https://www.greenweez.com/connexion",
  "signupUrl": "https://www.greenweez.com/inscription",
  "platform": "greenweez-next",
  "fulfillment": [
    "delivery"
  ],
  "accountRequired": true,
  "scopeFields": []
};
