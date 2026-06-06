const express = require('express');
const Category = require('../models/Category');
const { mapCategory } = require('../utils/mappers');
const { getDefaultCategoriesForApi } = require('../services/catalogImport');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    if (global.__mongoDown) {
      return res.json(getDefaultCategoriesForApi());
    }
    const list = await Category.find().sort({ name: 1 });
    if (!list.length) {
      return res.json(getDefaultCategoriesForApi());
    }
    res.json(list.map(mapCategory));
  } catch (e) {
    res.json(getDefaultCategoriesForApi());
  }
});

module.exports = router;
