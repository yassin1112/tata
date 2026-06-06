/**
 * Import data/products-catalog.json into MongoDB (upsert by slug).
 * Run: node server/scripts/import-catalog.js
 */
require('dotenv').config();
const { connectDb } = require('../config/db');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { readCatalog, replaceAll } = require('../services/productCatalog');
const { mapProduct } = require('../utils/mappers');

const categoryMap = {
  soins: 'skincare',
  visage: 'skincare',
  corps: 'skincare',
  cheveux: 'skincare',
  'maman-et-bebe': 'baby',
  maman: 'baby',
  hygiene: 'hygiene',
  hommes: 'hygiene',
  solaire: 'skincare',
  'complements-alimentaires': 'vitamins',
  'produits-paramedicaux': 'devices',
  beaute: 'skincare',
  'nos-promotions': 'skincare',
};

async function ensureCategories() {
  const defs = [
    { name: 'Soins & Visage', slug: 'skincare', icon: 'sparkles' },
    { name: 'Compléments', slug: 'vitamins', icon: 'pill' },
    { name: 'Hygiène', slug: 'hygiene', icon: 'droplet' },
    { name: 'Maman & Bébé', slug: 'baby', icon: 'heart' },
    { name: 'Paramédical', slug: 'devices', icon: 'activity' },
  ];
  const out = {};
  for (const c of defs) {
    let doc = await Category.findOne({ slug: c.slug });
    if (!doc) doc = await Category.create(c);
    out[c.slug] = doc._id;
  }
  return out;
}

function resolveCategoryId(entry, cats) {
  const raw = (entry.categorySlug || '').split('/').pop() || '';
  const key = raw.replace(/^\d+-/, '');
  const slug = categoryMap[key] || 'skincare';
  return cats[slug] || cats.skincare;
}

async function main() {
  const { products } = readCatalog();
  if (!products.length) {
    console.error('No products in catalog. Run: npm run catalog:scrape');
    process.exit(1);
  }

  await connectDb();
  const cats = await ensureCategories();

  const slugs = products.map((p) => p.slug);
  const existing = await Product.find({ slug: { $in: slugs } }).select('slug');
  const existingSet = new Set(existing.map((e) => e.slug));

  let created = 0;
  let updated = 0;
  const BATCH = 100;

  for (let i = 0; i < products.length; i += BATCH) {
    const chunk = products.slice(i, i + BATCH);
    const ops = chunk.map((p) => {
      const isNew = !existingSet.has(p.slug);
      if (isNew) created++;
      else updated++;

      const categoryId = resolveCategoryId(p, cats);
      const stockQty = Math.max(0, Number(p.stockQuantity) || 10);
      return {
        updateOne: {
          filter: { slug: p.slug },
          update: {
            $set: {
              categoryId,
              name: p.name,
              description: p.description || '',
              price: Number(p.price) || 0,
              compareAtPrice: p.compareAtPrice || null,
              imageUrl: p.imageUrl || '',
              lowStockThreshold: p.lowStockThreshold || 5,
              isActive: p.isActive !== false,
            },
            $setOnInsert: {
              slug: p.slug,
              stockQuantity: stockQty,
            },
          },
          upsert: true,
        },
      };
    });

    await Product.bulkWrite(ops, { ordered: false });
    console.log(`  ${Math.min(i + BATCH, products.length)} / ${products.length}`);
  }

  const all = await Product.find().sort({ name: 1 });
  replaceAll(all.map(mapProduct));

  console.log(`Import done — ${created} created, ${updated} updated (${products.length} in catalog)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
