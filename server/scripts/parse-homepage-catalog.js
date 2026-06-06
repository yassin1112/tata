/** Quick save: homepage products from local HTML or live fetch */
const fs = require('fs');
const path = require('path');
const { replaceAll } = require('../services/productCatalog');

const local = path.join(__dirname, '..', '..', 'tmp-parafendri.html');

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parsePrice(text) {
  if (!text) return 0;
  const n = String(text).replace(/[^\d.,]/g, '').replace(',', '.');
  return Math.round(parseFloat(n) * 1000) / 1000 || 0;
}

function parseListing(html) {
  const products = [];
  const re = /<article class="product-miniature[\s\S]*?<\/article>/g;
  let block;
  while ((block = re.exec(html))) {
    const chunk = block[0];
    const idM = chunk.match(/data-id-product="(\d+)"/);
    const titleM = chunk.match(/class="h3 product-title"[\s\S]*?<a[^>]+>([\s\S]*?)<\/a>/);
    const linkM = chunk.match(/class="h3 product-title"[\s\S]*?href="([^"]+)"/);
    const imgM =
      chunk.match(/data-full-size-image-url="([^"]+)"/) ||
      chunk.match(/data-src="([^"]+\.(?:webp|jpg|png))"/);
    const saleM = chunk.match(/class="price price-sale"[\s\S]*?>([\d\s,]+)\s*TND/);
    const regularM = chunk.match(/class="regular-price"[\s\S]*?>([\d\s,]+)\s*TND/);
    const priceM = chunk.match(/class="price"[^>]*>[\s\S]*?>([\d\s,]+)\s*TND/);
    const name = decodeHtml(titleM?.[1]?.replace(/<[^>]+>/g, ''));
    const url = linkM?.[1];
    if (!idM || !name) continue;
    const price = parsePrice(saleM?.[1] || priceM?.[1]);
    const compareAtPrice = regularM ? parsePrice(regularM[1]) : null;
    const slug = url?.match(/\/(\d+-[^/]+)\.html/)?.[1]?.toLowerCase() || name.toLowerCase().replace(/\s+/g, '-');
    products.push({
      externalId: idM[1],
      name,
      slug,
      description: '',
      price,
      compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
      imageUrl: imgM?.[1] || '',
      stockQuantity: 50,
      lowStockThreshold: 5,
      isActive: true,
    });
  }
  return products;
}

async function main() {
  let html;
  if (fs.existsSync(local)) html = fs.readFileSync(local, 'utf8');
  else {
    const res = await fetch('https://parafendri.tn/');
    html = await res.text();
  }
  const products = parseListing(html);
  replaceAll(products);
  console.log(`Saved ${products.length} homepage products to catalog`);
}

main().catch(console.error);
