import {
  ROBOT_PATTERN, formatEuro, hasVeganClaim, isObject, isOrganic, parsePrice, str, stripTags,
  type Adapter, type MutationInput, type SessionSignals,
} from "./adapter.js";
import { ContractChangedError } from "./errors.js";
import type { CartInput, ProductInput, SummaryInput } from "./types.js";

const HOSTS = new Set(["www.greenweez.com", "greenweez.com"]);

// Recherche et fiches : HTML rendu par le serveur du site, lu dans la session
// Camoufox. Panier : API GraphQL du site, avec le jeton de la session connectée
// (Greenweez n’ouvre pas de panier sans compte).
const PRELUDE = String.raw`
const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const cookie = (name) => { const found = document.cookie.split(";").map((v) => v.trim()).find((v) => v.indexOf(name + "=") === 0); return found ? decodeURIComponent(found.slice(name.length + 1)) : null; };
const page = async (path) => {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new Error("Page " + path + " HTTP " + response.status);
  const html = await response.text();
  return { html: html, doc: new DOMParser().parseFromString(html, "text/html") };
};
const session = async () => {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  const json = await response.json().catch(() => null);
  const token = json && json.user && json.user.token;
  if (!response.ok || !token) throw new Error("GREENWEEZ_LOGIN_REQUIRED : connecte-toi à ton compte Greenweez dans la fenêtre Camoufox, Greenweez n’ouvre pas de panier sans compte.");
  const userToken = cookie("gwz-user-token");
  if (!userToken) throw new Error("Jeton utilisateur Greenweez absent de la session");
  return { token: token, userToken: userToken };
};
const graphql = async (operationName, query, variables) => {
  const auth = await session();
  const requestId = btoa(String.fromCharCode.apply(null, Array.from(crypto.getRandomValues(new Uint8Array(18))))).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 21);
  const response = await fetch("https://api.greenweez.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "source-platform": "web", "request-id": requestId, "apollo-require-preflight": "true", "x-algolia-user-token": auth.userToken, authorization: "Bearer " + auth.token },
    body: JSON.stringify({ operationName: operationName, query: query, variables: variables }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || (Array.isArray(json.errors) && json.errors.length)) throw new Error("GraphQL " + operationName + " (" + response.status + ") : " + clean(json && json.errors && json.errors[0] && json.errors[0].message).slice(0, 200));
  return json.data;
};
const CART = "query Cart($cartToken: String!) { cart(cartToken: $cartToken) { tokenValue totalItems items { id quantity offer { id quantityAvailable status pricing { price } variant { code product { slug name brand { name } } } } } } }";
const ADD = "mutation AddToCart($cartToken: String, $offerId: Int, $offers: [OfferWithQuantity]) { addOffersToCart(cartToken: $cartToken, offerId: $offerId, offers: $offers) { orderToken offerId } }";
const REMOVE = "mutation DeleteCartItems($cartToken: String!, $cartItemsId: [Int]!) { deleteCartItems(cartToken: $cartToken, cartItemsId: $cartItemsId) { orderToken } }";
const readCart = async () => {
  await session();
  const cartToken = cookie("cartToken");
  if (!cartToken) return { total: 0, items: [], lines: [] };
  const data = await graphql("Cart", CART, { cartToken: cartToken });
  const cart = data && data.cart;
  if (!cart || !Array.isArray(cart.items)) throw new Error("Contrat panier Greenweez absent");
  const lines = cart.items.map((item) => ({
    line_id: Number(item.id), offer_id: Number(item.offer.id), product_id: item.offer.variant.code,
    name: item.offer.variant.product.name, quantity: item.quantity,
    unit_price: item.offer.pricing.price / 100, line_total: (item.offer.pricing.price * item.quantity) / 100,
    maximum: item.offer.quantityAvailable,
  }));
  const byProduct = {};
  lines.forEach((line) => {
    const entry = byProduct[line.product_id] || (byProduct[line.product_id] = { product_id: line.product_id, name: line.name, quantity: 0, unit_price: line.unit_price, line_total: 0, maximum: line.maximum });
    entry.quantity += line.quantity; entry.line_total += line.line_total;
  });
  const items = Object.keys(byProduct).map((key) => byProduct[key]);
  return { total: items.reduce((sum, item) => sum + item.line_total, 0), items: items, lines: lines };
};
const offerFromHtml = (html, reference) => {
  const text = html.replace(/\\"/g, '"');
  let at = text.indexOf('"code":"' + reference + '"');
  if (at < 0) at = 0;
  const start = text.indexOf('"mainOffer":{', at);
  if (start < 0) return null;
  const block = text.slice(start, start + 6000);
  const id = block.match(/"mainOffer":\{"id":"(\d+)"/);
  const available = block.match(/"quantityAvailable":(\d+)/);
  const price = block.match(/"pricing":\{"price":(\d+)/);
  return id ? { offer_id: Number(id[1]), quantity_available: available ? Number(available[1]) : null, price_cents: price ? Number(price[1]) : null } : null;
};
`;

function searchExpression(query: string, limit: number): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const result = await page("/recherche/" + encodeURIComponent(${JSON.stringify(query)}));
    const articles = Array.from(result.doc.querySelectorAll("main article"));
    if (!result.doc.querySelector("main")) throw new Error("Contrat page de recherche Greenweez absent");
    return articles.map((article) => {
      const link = article.querySelector('a[href*="/produit/"]');
      if (!link) return null;
      const url = new URL(link.getAttribute("href"), location.origin).toString();
      const reference = url.split("/").filter(Boolean).pop();
      const image = link.querySelector("img");
      const texts = Array.from(article.querySelectorAll("p")).map((node) => clean(node.textContent)).filter(Boolean);
      const name = clean(image && image.getAttribute("alt")) || texts.find((value) => value.length > 3) || null;
      const index = texts.indexOf(name);
      const priceNode = article.querySelector("ins");
      const price = clean(priceNode && priceNode.textContent) || texts.find((value) => /€/.test(value) && !/\/\s*(kg|l)\b/i.test(value)) || null;
      const unitPrice = texts.find((value) => /€\s*\/\s*(kg|l)\b/i.test(value)) || null;
      const all = clean(article.textContent);
      const button = Array.from(article.querySelectorAll("button")).find((node) => /ajouter/i.test(clean(node.textContent)) || /ajouter/i.test(node.getAttribute("aria-label") || ""));
      const availability = /rupture|indisponible|épuisé/i.test(all) ? "out_of_stock" : button && !button.disabled ? "available" : "unknown";
      return reference && name ? { reference: reference, name: name, brand: index > 0 ? texts[index - 1] : null, price: price, unit_price: unitPrice, url: url, availability: availability } : null;
    }).filter(Boolean).slice(0, ${limit});
  })()`;
}

function productExpression(productUrl: string): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const url = new URL(${JSON.stringify(productUrl)});
    const reference = url.pathname.split("/").filter(Boolean).pop();
    const result = await page(url.pathname);
    let ld = null;
    Array.from(result.doc.querySelectorAll('script[type="application/ld+json"]')).forEach((node) => {
      try { const json = JSON.parse(node.textContent); const list = Array.isArray(json) ? json : (json["@graph"] || [json]); const found = list.find((entry) => entry && (entry["@type"] === "Product" || (Array.isArray(entry["@type"]) && entry["@type"].indexOf("Product") >= 0))); if (found && !ld) ld = found; } catch (error) { /* bloc non exploitable */ }
    });
    if (!ld) throw new Error("Contrat JSON-LD Product absent de la fiche Greenweez");
    const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    const main = result.doc.querySelector("main");
    const labelled = (label) => { const node = main ? Array.from(main.querySelectorAll("p")).find((p) => new RegExp("^\\s*" + label + "\\s*:", "i").test(p.textContent || "")) : null; return node ? clean((node.textContent || "").replace(new RegExp("^\\s*" + label + "\\s*:\\s*", "i"), "")) : null; };
    const inner = offerFromHtml(result.html, reference);
    return {
      reference: reference, name: ld.name, brand: ld.brand && (ld.brand.name || ld.brand) || null, gtin: ld.gtin13 || ld.gtin || null,
      price: inner && inner.price_cents != null ? inner.price_cents / 100 : offer && offer.price,
      availability: offer && offer.availability || null, quantity_available: inner ? inner.quantity_available : null,
      offer_id: inner ? inner.offer_id : null, description: ld.description || "",
      ingredients: labelled("Ingrédients"), nutrition: labelled("Valeurs nutritionnelles pour 100g"),
      unit_price: (clean(main && main.textContent).match(/([\d,.]+\s*€\s*\/\s*(?:kg|l))/i) || [])[1] || null,
    };
  })()`;
}

function cartExpression(): string {
  return String.raw`(async () => { ${PRELUDE} const cart = await readCart(); return { total: cart.total, items: cart.items }; })()`;
}

function mutationExpression(input: MutationInput): string {
  return String.raw`(async () => {
    ${PRELUDE}
    const productId = ${JSON.stringify(input.productId)};
    const productUrl = ${JSON.stringify(input.productUrl)};
    const target = ${input.targetQuantity};
    const before = await readCart();
    const lines = before.lines.filter((line) => line.product_id === productId);
    const current = lines.reduce((sum, line) => sum + line.quantity, 0);
    const strip = (cart) => ({ total: cart.total, items: cart.items });
    if (current === target) return { before: strip(before), after: strip(before), applied: false };
    let offerId = lines.length ? lines[0].offer_id : null;
    if (!offerId && target > 0) {
      if (!productUrl) throw new Error("Adresse de la fiche requise pour ajouter ce produit");
      const result = await page(new URL(productUrl).pathname);
      const offer = offerFromHtml(result.html, productId);
      if (!offer) throw new Error("Offre Greenweez introuvable sur la fiche " + productId);
      offerId = offer.offer_id;
    }
    let count = current;
    if (target < current) {
      await graphql("DeleteCartItems", REMOVE, { cartToken: cookie("cartToken"), cartItemsId: lines.map((line) => line.line_id) });
      count = 0;
    }
    for (; count < target; count += 1) {
      const data = await graphql("AddToCart", ADD, { cartToken: cookie("cartToken"), offerId: offerId });
      const token = data && data.addOffersToCart && data.addOffersToCart.orderToken;
      if (!token) throw new Error("Contrat ajout au panier Greenweez absent");
      if (!cookie("cartToken")) document.cookie = "cartToken=" + encodeURIComponent(token) + "; path=/; max-age=2592000; SameSite=Lax";
    }
    return { before: strip(before), after: strip(await readCart()), applied: true };
  })()`;
}

export const adapter: Adapter = {
  entryUrl: () => "https://www.greenweez.com/",
  matchesTab: (u) => u.protocol === "https:" && HOSTS.has(u.hostname),
  inspectSession({ snapshot, tabUrl }): SessionSignals {
    let onSite = false;
    try { onSite = HOSTS.has(new URL(tabUrl).hostname); } catch { onSite = false; }
    const robotVisible = ROBOT_PATTERN.test(snapshot);
    return { ready: onSite && !robotVisible && snapshot.trim().length > 0, robotVisible, accountConnected: /voir mes informations de compte|bienvenue\s+\S|d[ée]connexion/i.test(snapshot) };
  },
  validateProductUrl(u) {
    if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || !/^\/produit\/[a-z0-9]+(?:-[a-z0-9]+)*\/[A-Z0-9]+$/i.test(u.pathname)) throw new Error("Hors des fiches produit Greenweez.");
  },
  searchExpression: (_config, query, limit) => searchExpression(query, limit),
  normalizeSearch(raw): SummaryInput[] {
    if (!Array.isArray(raw)) throw new ContractChangedError("La recherche n’a pas retourné une liste de produits.");
    return raw.map((entry): SummaryInput => {
      if (!isObject(entry)) throw new ContractChangedError("Un produit n’est plus un objet exploitable.");
      const id = str(entry, "reference");
      const name = str(entry, "name");
      const price = parsePrice(entry.price);
      const link = str(entry, "url");
      if (!id || !name || price === null || !link) throw new ContractChangedError("Un produit ne contient plus sa référence, son nom, son prix ou son adresse.");
      const availability = entry.availability === "available" || entry.availability === "out_of_stock" ? entry.availability : "unknown";
      return { product_id: id, name, brand: str(entry, "brand"), price, unit_price: str(entry, "unit_price"), availability, available_quantity: null, organic: isOrganic(name), product_url: link };
    });
  },
  productExpression: (_config, productUrl) => productExpression(productUrl),
  normalizeProduct(raw, _config, requestedUrl): ProductInput {
    if (!isObject(raw)) throw new ContractChangedError("La fiche n’a pas retourné l’objet produit attendu.");
    const id = str(raw, "reference");
    const name = str(raw, "name");
    const price = parsePrice(raw.price);
    if (!id || !name || price === null) throw new ContractChangedError("La fiche ne contient plus sa référence, son nom ou son prix.");
    const stock = typeof raw.quantity_available === "number" && Number.isInteger(raw.quantity_available) && raw.quantity_available >= 0 ? raw.quantity_available : null;
    const schema = str(raw, "availability") ?? "";
    const availability = stock !== null ? (stock > 0 ? "available" : "out_of_stock") : /InStock/i.test(schema) ? "available" : /OutOfStock/i.test(schema) ? "out_of_stock" : "unknown";
    const nutritionText = str(raw, "nutrition");
    return {
      product_id: id, name, brand: str(raw, "brand"), price, unit_price: str(raw, "unit_price"), availability, available_quantity: stock,
      organic: isOrganic(`${name} ${str(raw, "description") ?? ""}`), product_url: requestedUrl, ean: str(raw, "gtin"), ingredients: str(raw, "ingredients"),
      vegan_claim: hasVeganClaim(stripTags(`${name} ${str(raw, "description") ?? ""}`)),
      nutrition: nutritionText ? [{ label: "Valeurs nutritionnelles pour 100 g", value: nutritionText, unit: null }] : [],
    };
  },
  cartExpression: () => cartExpression(),
  normalizeCart(raw): CartInput {
    if (!isObject(raw) || !Array.isArray(raw.items)) throw new ContractChangedError("Le panier n’a plus la forme observée.");
    const items = raw.items.map((entry) => {
      if (!isObject(entry)) throw new ContractChangedError("Une ligne de panier n’est plus exploitable.");
      const id = str(entry, "product_id");
      const quantity = Number(entry.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 0) throw new ContractChangedError("Une ligne de panier ne contient plus sa référence ou sa quantité.");
      const maximum = typeof entry.maximum === "number" && Number.isInteger(entry.maximum) && entry.maximum >= 0 ? entry.maximum : null;
      return { product_id: id, name: str(entry, "name"), quantity, available_quantity: maximum, unit_price: parsePrice(entry.unit_price), line_total: parsePrice(entry.line_total) };
    });
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return { empty: totalQuantity === 0, total_quantity: totalQuantity, total_price: formatEuro(parsePrice(raw.total) ?? 0), items };
  },
  mutationExpression: (_config, input) => mutationExpression(input),
};
