/**
 * Scrape products from parafendri.tn (PrestaShop) into data/products-catalog.json
 * Run: node server/scripts/scrape-parafendri.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { replaceAll } = require('../services/productCatalog');

const BASE = 'https://parafendri.tn';
const DELAY_MS = 120;
const FETCH_DESC = process.env.FETCH_DESC === '1' || process.argv.includes('--desc');
const CONCURRENCY = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parsePrice(text) {
  if (!text) return 0;
  const n = String(text).replace(/[^\d.,]/g, '').replace(',', '.');
  return Math.round(parseFloat(n) * 1000) / 1000 || 0;
}

function slugFromUrl(url) {
  const m = url.match(/\/(\d+)-([^/]+)\.html/);
  if (!m) return slugify(url);
  return `${m[1]}-${m[2]}`.toLowerCase();
}

function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ParaPublicCatalogBot/1.0',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseListing(html) {
  const products = [];
  const re = /<article class="product-miniature[\s\S]*?<\/article>/g;
  let block;
  while ((block = re.exec(html))) {
    const chunk = block[0];
    const idM = chunk.match(/data-id-product="(\d+)"/);
    if (!idM) continue;
    const titleM = chunk.match(/class="h3 product-title"[\s\S]*?<a[^>]+>([\s\S]*?)<\/a>/);
    const linkM = chunk.match(/class="h3 product-title"[\s\S]*?href="([^"]+)"/);
    const imgM =
      chunk.match(/data-full-size-image-url="([^"]+)"/) ||
      chunk.match(/data-src="([^"]+\.(?:webp|jpg|png))"/);
    const saleM = chunk.match(/class="price price-sale"[\s\S]*?>([\d\s,]+)\s*TND/);
    const regularM = chunk.match(/class="regular-price"[\s\S]*?>([\d\s,]+)\s*TND/);
    const priceM = chunk.match(/class="price"[^>]*>[\s\S]*?>([\d\s,]+)\s*TND/);

    const name = decodeHtml(titleM?.[1]?.replace(/<[^>]+>/g, ''));
    const url = linkM?.[1]?.replace(/^\/\//, 'https://');
    if (!name || !url) continue;

    const price = parsePrice(saleM?.[1] || priceM?.[1]);
    const compareAtPrice = regularM ? parsePrice(regularM[1]) : null;
    const imageUrl = imgM?.[1] || '';

    products.push({
      externalId: idM[1],
      name,
      slug: slugFromUrl(url),
      url,
      description: '',
      price,
      compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
      imageUrl,
      categorySlug: null,
      categoryName: null,
      stockQuantity: 50,
      lowStockThreshold: 5,
      isActive: true,
    });
  }
  return products;
}

function extractCategoryUrls(html) {
  const urls = new Set();
  const re = /href="(https:\/\/parafendri\.tn\/\d+-[^"#?]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1].split('?')[0];
    if (!u.includes('/brand/') && !u.includes('/module/')) urls.add(u);
  }
  return [...urls];
}

async function fetchProductDescription(url) {
  try {
    const html = await fetchText(url);
    const shortM = html.match(/id="product-description-short-[\d]+"[^>]*>([\s\S]*?)<\/div>/);
    const longM = html.match(/id="product-description"[^>]*>([\s\S]*?)<\/div>/);
    const raw = shortM?.[1] || longM?.[1] || '';
    return decodeHtml(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 1200);
  } catch {
    return '';
  }
}

async function crawlCategory(categoryUrl, seen, all) {
  let page = 1;
  let added = 0;
  while (page <= 40) {
    const url = page === 1 ? categoryUrl : `${categoryUrl}?page=${page}`;
    let html;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const list = parseListing(html);
    if (!list.length) break;
    let pageNew = 0;
    for (const p of list) {
      if (seen.has(p.externalId)) continue;
      seen.add(p.externalId);
      const catSlug = categoryUrl.replace(BASE + '/', '').split('?')[0];
      p.categorySlug = catSlug;
      all.push(p);
      pageNew++;
      added++;
    }
    if (!pageNew) break;
    page++;
    await sleep(DELAY_MS);
  }
  return added;
}

async function main() {
  console.log('Fetching parafendri.tn homepage…');
  const homeHtml = await fetchText(BASE + '/');
  const categories = extractCategoryUrls(homeHtml);
  console.log(`Found ${categories.length} category URLs`);

  const seen = new Set();
  const all = [];

  const homeProducts = parseListing(homeHtml);
  for (const p of homeProducts) {
    if (seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    all.push(p);
  }
  console.log(`Homepage: ${homeProducts.length} products`);

  const saveProgress = () => {
    const snapshot = all.map(({ url, ...rest }) => rest);
    replaceAll(snapshot);
  };

  let idx = 0;
  async function worker() {
    while (idx < categories.length) {
      const i = idx++;
      const cat = categories[i];
      const n = await crawlCategory(cat, seen, all);
      if (n > 0) {
        console.log(`[${i + 1}/${categories.length}] ${cat} → +${n} (total ${all.length})`);
        saveProgress();
      }
      await sleep(DELAY_MS);
    }
  }
  saveProgress();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (FETCH_DESC) {
    console.log(`Fetching descriptions for ${all.length} products…`);
    for (let i = 0; i < all.length; i++) {
      if (!all[i].description && all[i].url) {
        all[i].description = await fetchProductDescription(all[i].url);
        if ((i + 1) % 50 === 0) console.log(`  descriptions ${i + 1}/${all.length}`);
        await sleep(DELAY_MS);
      }
      delete all[i].url;
    }
  } else {
    for (const p of all) delete p.url;
    console.log('Skipping descriptions (set FETCH_DESC=1 to fetch)');
  }

  replaceAll(all);
  console.log(`Done — ${all.length} products saved to data/products-catalog.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
