// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mock database for demonstration purposes
// In a real production environment, you would likely query a database or call an external API like StockX/Goat
const MOCK_DB: Record<string, any> = {
  'DD1391-100': {
    name: 'Nike Dunk Low Black White (Panda)',
    brand: 'Nike',
    imageUrl: 'https://images.stockx.com/images/Nike-Dunk-Low-Retro-White-Black-2021-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1633027409',
    price: 749
  },
  'DZ5485-612': {
    name: 'Jordan 1 Retro High OG Chicago Lost and Found',
    brand: 'Jordan',
    imageUrl: 'https://images.stockx.com/images/Air-Jordan-1-Retro-High-OG-Chicago-Reimagined-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1665691079',
    price: 1299
  },
  'HP5425': {
    name: 'adidas Yeezy Slide Onyx',
    brand: 'adidas',
    imageUrl: 'https://images.stockx.com/images/adidas-Yeezy-Slide-Onyx-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1646687037',
    price: 599
  },
  'HQ6448': {
    name: 'adidas Yeezy Slide Bone (2022 Restock)',
    brand: 'adidas',
    imageUrl: 'https://images.stockx.com/images/adidas-Yeezy-Slide-Bone-2022-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1658844885',
    price: 649
  },
  'DM7866-162': {
      name: 'Air Jordan 1 Low Travis Scott Reverse Mocha',
      brand: 'Jordan',
      imageUrl: 'https://images.stockx.com/images/Air-Jordan-1-Low-Travis-Scott-Reverse-Mocha-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1658432354',
      price: 5899
  }
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { sku } = await req.json()
    
    if (!sku) {
      throw new Error('SKU is required')
    }

    let cleanSku = sku.trim().toUpperCase();
    console.log(`Original Input: ${cleanSku}`);

    // Intelligent Extraction: Try to find SKU pattern if input is a long string
    // Nike/Jordan Pattern: 2 letters + 4 digits + hyphen + 3 digits (e.g., DD1391-100)
    // Or 6 chars + hyphen + 3 digits (e.g., CZ0790-104)
    const nikePattern = /([A-Z]{2}\d{4}-\d{3})|([A-Z0-9]{6}-\d{3})/;
    const nikeMatch = cleanSku.match(nikePattern);
    
    // Adidas Pattern: 6 alphanumeric (e.g., HP5425, GW3774) - strictly 6 chars often start with letter
    // This is riskier as it might match other words, so we only apply if the input is long
    const adidasPattern = /\b([A-Z]{2,3}\d{3,4})\b|\b([A-Z]\d{5})\b/; 
    
    if (nikeMatch) {
        cleanSku = nikeMatch[0];
        console.log(`Extracted Nike/Jordan SKU: ${cleanSku}`);
    } else if (cleanSku.length > 10) {
         // Only try to extract adidas style if the string is long (likely a full title)
         const adidasMatch = cleanSku.match(adidasPattern);
         if (adidasMatch) {
             cleanSku = adidasMatch[0];
             console.log(`Extracted Potential SKU: ${cleanSku}`);
         }
    }

    console.log(`Final Lookup SKU: ${cleanSku}`);

    // 1. Check Mock Database first
    let product = MOCK_DB[cleanSku];

    // 2. If not found in exact match, try fuzzy search in mock DB (for demo)
    if (!product) {
       const foundKey = Object.keys(MOCK_DB).find(k => cleanSku.includes(k) || k.includes(cleanSku));
       if (foundKey) {
           product = MOCK_DB[foundKey];
       }
    }

    // 3. (Optional) External API Integration Point
    // If you have an external API key (e.g., for a sneaker data provider), you would add the fetch logic here.
    // const externalData = await fetch(`https://api.example.com/products/${cleanSku}`, { headers: { 'Authorization': 'Bearer YOUR_KEY' } });
    
    if (product) {
      return new Response(
        JSON.stringify({
          found: true,
          ...product
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        },
      )
    } else {
      return new Response(
        JSON.stringify({
          found: false,
          message: 'Product not found'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 // Return 200 even if not found to handle gracefully in frontend
        },
      )
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})
