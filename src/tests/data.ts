import type { Captured } from "./fake-browser.js";

export const captured: Captured = {
  "query": "tofu",
  "productUrl": "https://www.greenweez.com/produit/tofu-nature-vegan-200g/1MOUL0212",
  "expected": {
    "productId": "1MOUL0212",
    "name": "Tofu nature végan bio 200g",
    "price": 2.6
  },
  "searchRaw": [
    {
      "reference": "1MOUL0212",
      "name": "Tofu nature végan bio 200g",
      "brand": "Moulin des Moines",
      "price": "2,60€",
      "unit_price": "13,00€ / Kg",
      "url": "https://www.greenweez.com/produit/tofu-nature-vegan-200g/1MOUL0212",
      "availability": "available"
    },
    {
      "reference": "1TAIF0009",
      "name": "Tofu à l'ail des ours bio 2x80g",
      "brand": "Taifun",
      "price": "2,84€",
      "unit_price": "17,75€ / Kg",
      "url": "https://www.greenweez.com/produit/tofu-a-lail-des-ours-2x80g/1TAIF0009",
      "availability": "available"
    },
    {
      "reference": "1TAIF0003",
      "name": "Tofu fumé amandes sésame bio 200g",
      "brand": "Taifun",
      "price": "3,49€",
      "unit_price": "17,45€ / Kg",
      "url": "https://www.greenweez.com/produit/tofu-fume-amandes-sesame-200g/1TAIF0003",
      "availability": "available"
    }
  ],
  "productRaw": {
    "reference": "1MOUL0212",
    "name": "Tofu nature végan bio Moulin des Moines 200g",
    "brand": "Moulin des Moines",
    "gtin": "3347430017800",
    "price": 2.6,
    "availability": "https://schema.org/InStock",
    "quantity_available": 793,
    "offer_id": 74370,
    "description": "Tofu nature végan bio Moulin des Moines, idéal pour confectionner des farces végétales. Tranche prête à être coupée, délicieuse grillée ou marinée.",
    "ingredients": "Eau, soja* (20%) (*ingrédient issu de l'agriculture biologique)",
    "nutrition": null,
    "unit_price": "13,00€ / Kg"
  },
  "cartEmpty": {
    "total": 0,
    "items": []
  },
  "cartFilled": {
    "quantity": 2,
    "raw": {
      "total": 5.2,
      "items": [
        {
          "product_id": "1MOUL0212",
          "name": "Tofu nature végan bio 200g",
          "quantity": 2,
          "unit_price": 2.6,
          "line_total": 5.2,
          "maximum": 793
        }
      ]
    }
  }
};
