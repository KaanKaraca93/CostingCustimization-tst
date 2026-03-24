const { getCurrencyRate, isPlacementInCategory, PLACEMENT_MAPPINGS, getAllDefinedPlacements } = require('../config/placementMapping');
const { calculateAllFormulas } = require('../utils/formulaEvaluator');

/**
 * BOM to Costing Calculation Service
 * Processes BOM lines and maps them to cost elements
 */

/**
 * Process BOM data to update costing
 * @param {Object} styleData - Parsed style data with BOM
 * @returns {Object} Calculated costing data for PATCH
 */
function processBomToCosting(styleData) {
  try {
    console.log('\n📊 ===== BOM TO COSTING CALCULATION =====');
    
    const styleInfo = styleData.styleInfo;
    const styleId = styleInfo.styleId;
    const styleCode = styleInfo.styleCode;

    console.log(`📋 Style Info: ID=${styleId}, Code=${styleCode}`);

    // Get BOM lines
    if (!styleData.bom || !styleData.bom.bomLines || styleData.bom.bomLines.length === 0) {
      throw new Error('No BOM lines found in style data');
    }

    const bomLines = styleData.bom.bomLines;
    console.log(`📦 Total BOM Lines: ${bomLines.length}`);

    // Get unlocked suppliers
    const styleCostSuppliers = styleData.costSuppliers || [];
    const unlockedSuppliers = styleCostSuppliers.filter(supplier => !supplier.isLock);
    
    console.log(`🔓 Unlocked Suppliers: ${unlockedSuppliers.length}`);
    unlockedSuppliers.forEach((supplier, index) => {
      const supplierInfo = supplier.supplierInfo;
      if (supplierInfo) {
        console.log(`   ${index + 1}. Code="${supplierInfo.code}", Name="${supplierInfo.supplierName}", Id=${supplier.id}`);
      }
    });

    if (unlockedSuppliers.length === 0) {
      throw new Error("No unlocked suppliers found in StyleCostSuppliers");
    }

    const styleCostElements = styleData.costElements || [];
    console.log(`📋 Total Cost Elements: ${styleCostElements.length}`);

    // Initialize result
    const result = {
      StyleId: styleId,
      StyleCode: styleCode,
      supplierValues: []
    };

    // Get dynamic currency rates from PLM extended fields (Cost10 → CurrencyId=3, Cost14 → CurrencyId=1)
    const currencyRates = styleData.currencyRates || {};
    console.log(`💱 Currency Rates: CurrencyId=1 → ${currencyRates[1] || 'fallback:64'}, CurrencyId=3 → ${currencyRates[3] || 'fallback:55'}, CurrencyId=4 → 1`);

    // Process BOM lines and calculate cost element values
    const costElementValues = processBomLines(bomLines, currencyRates);
    
    console.log('\n📊 Calculated Cost Element Values:');
    Object.keys(costElementValues).forEach(code => {
      console.log(`   ${code}: ${costElementValues[code].toFixed(2)}`);
    });

    // Write cost element values to result
    console.log('\n💾 Writing cost element values to suppliers...');
    
    for (const [elementCode, value] of Object.entries(costElementValues)) {
      const element = styleCostElements.find(e => e.code === elementCode);
      
      if (!element) {
        console.warn(`⚠️  Cost Element Code='${elementCode}' not found (skipping)`);
        continue;
      }

      const supplierVals = element.supplierValues || [];
      let foundCount = 0;

      for (const unlockedSupplier of unlockedSuppliers) {
        const targetVal = supplierVals.find(val => val.StyleCostingSupplierId === unlockedSupplier.id);
        
        if (targetVal) {
          result.supplierValues.push({
            Id: targetVal.Id,
            Value: Math.round(value * 100) / 100, // Round to 2 decimals
            elementCode: elementCode,
            supplierId: unlockedSupplier.id
          });
          foundCount++;
        }
      }

      console.log(`   ✅ ${elementCode}: Value=${value.toFixed(2)}, Found ${foundCount}/${unlockedSuppliers.length} supplier values`);
    }

    // Process EACH supplier separately with their own values
    console.log('\n🧮 Calculating Type=3 for each supplier separately...');
    
    const type1Elements = styleCostElements.filter(elem => elem.type === 1);
    const type3Elements = styleCostElements.filter(elem => elem.type === 3);
    console.log(`📋 Found ${type3Elements.length} Type=3 elements to calculate for ${unlockedSuppliers.length} suppliers`);
    
    // Process each unlocked supplier
    for (const unlockedSupplier of unlockedSuppliers) {
      console.log(`\n👤 Processing Supplier ${unlockedSupplier.id} (Code: ${unlockedSupplier.supplierInfo?.code})...`);
      
      const overrideValues = new Map();
      
      // 1. FIRST: Read ALL existing Type=1 values from THIS supplier (like BOO workflow)
      console.log(`   📊 Reading existing Type=1 values from cost elements...`);
      for (const element of type1Elements) {
        let existingValue = 0;
        
        // Get value from THIS supplier
        if (element.supplierValues && element.supplierValues.length > 0) {
          const supplierVal = element.supplierValues.find(val => val.StyleCostingSupplierId === unlockedSupplier.id);
          
          if (supplierVal) {
            existingValue = parseFloat(supplierVal.Value) || 0;
          }
        }
        
        overrideValues.set(element.code, existingValue);
      }
      console.log(`   ✅ Read ${overrideValues.size} Type=1 values from cost elements`);
      
      // 2. THEN: Override with BOM-calculated values (same for all suppliers)
      console.log(`   🆕 Overriding with ${Object.keys(costElementValues).length} BOM-calculated values...`);
      for (const [code, value] of Object.entries(costElementValues)) {
        overrideValues.set(code, value);
        console.log(`      ${code} = ${value.toFixed(2)} (from BOM)`);
      }
      
      // 3. Calculate Type=3 formulas for THIS supplier using THEIR values
      const calculatedValues = calculateAllFormulas(styleCostElements, overrideValues);
      
      // 4. Patch calculated values to THIS supplier
      for (const element of type3Elements) {
        let calculatedValue = calculatedValues.get(element.code);
        
        // If no formula or calculation failed, use 0
        if (calculatedValue === undefined || isNaN(calculatedValue)) {
          calculatedValue = 0;
        }
        
        calculatedValue = Math.round(calculatedValue * 100) / 100;
        
        const supplierVals = element.supplierValues || [];
        const targetVal = supplierVals.find(val => val.StyleCostingSupplierId === unlockedSupplier.id);
        
        if (targetVal) {
          result.supplierValues.push({
            Id: targetVal.Id,
            Value: calculatedValue,
            elementCode: element.code,
            supplierId: unlockedSupplier.id
          });
        }
      }
      
      console.log(`   ✅ Calculated and patched ${type3Elements.length} Type=3 elements for supplier ${unlockedSupplier.id}`);
    }

    /* ===== EXTENDED FIELDS PROCESSING - DISABLED (handled by ION) =====
    // Extended fields are now managed by ION/PLM workflow, not by Heroku
    console.log('\n📝 Processing Extended Fields...');

    // Get existing extended field values from styleData
    const styleExtendedFieldValues = styleData.extendedFields || [];
    console.log(`📋 Found ${styleExtendedFieldValues.length} extended field records`);

    // Mapping: ExtFldId -> calculation source
    const extendedFieldMapping = {
      'TKMS': '14a52574-591e-4082-83e7-6a401808b726',
      'TAST': 'c645f6f2-d537-4234-87c1-7675677ffb86',
      'TISC': 'a28b4eca-999c-4437-bb49-7fda0284993c',
      'TTRM': '556a9af5-6350-4bce-ae83-f1453ec3659b',
      'TISL': '40ea5b12-832b-41e9-aefb-e547d1e6884b',
      'TDGR': 'bc11923a-8594-4f22-b2bb-ab7f5f558ba7'
    };

    // For extended fields, we'll use the values from the last (or first) unlocked supplier
    // since extended fields are not supplier-specific
    let referenceSupplier = unlockedSuppliers[unlockedSuppliers.length - 1]; // Use last supplier
    if (!referenceSupplier) {
      console.log('⚠️  No unlocked suppliers found for extended fields');
      console.log('\n✅ BOM Costing calculation completed for StyleId:', styleId);
      return result;
    }

    console.log(`📌 Using supplier ${referenceSupplier.id} (Code: ${referenceSupplier.supplierInfo?.code}) as reference for extended fields`);

    // Build override values for the reference supplier
    const referenceOverrideValues = new Map();
    
    // Add BOM-calculated values
    for (const [code, value] of Object.entries(costElementValues)) {
      referenceOverrideValues.set(code, value);
    }
    
    // Add Type=1 values from reference supplier
    for (const element of type1Elements) {
      if (!referenceOverrideValues.has(element.code)) {
        let existingValue = 0;
        
        if (element.supplierValues && element.supplierValues.length > 0) {
          const supplierVal = element.supplierValues.find(val => val.StyleCostingSupplierId === referenceSupplier.id);
          
          if (supplierVal) {
            existingValue = parseFloat(supplierVal.Value) || 0;
          }
        }
        
        referenceOverrideValues.set(element.code, existingValue);
      }
    }
    
    // Calculate Type=3 values for reference supplier
    const referenceCalculatedValues = calculateAllFormulas(styleCostElements, referenceOverrideValues);

    // Populate extended fields
    for (const [code, extFldId] of Object.entries(extendedFieldMapping)) {
      // Find the extended field record with this ExtFldId
      const extFieldRecord = styleExtendedFieldValues.find(ef => ef.extFldId === extFldId);
      
      if (!extFieldRecord) {
        console.log(`   ⚠️  Extended field record for ${code} (ExtFldId: ${extFldId}) not found`);
        continue;
      }

      // Get the calculated value
      let value = referenceCalculatedValues.get(code);
      
      if (value === undefined || isNaN(value)) {
        value = 0;
      }
      
      value = Math.round(value * 100) / 100;
      
      // Add to result for patching
      result[`${code}_extid`] = extFieldRecord.id; // Use the record Id, not ExtFldId
      result[`${code}_extvalue`] = value;
      
      console.log(`   ✅ ${code}: Id=${extFieldRecord.id}, Value=${value.toFixed(2)}`);
    }
    ===== END DISABLED ===== */

    console.log('\n✅ BOM Costing calculation completed for StyleId:', styleId);
    return result;

  } catch (error) {
    console.error('❌ Error in processBomToCosting:', error.message);
    throw error;
  }
}

/**
 * Process BOM lines and calculate cost element values
 * @param {Array} bomLines - Array of BOM line objects
 * @param {Object} currencyRates - Dynamic currency rates from PLM { 1: rate, 3: rate, 4: 1 }
 * @returns {Object} Object with cost element codes as keys and calculated values
 */
function processBomLines(bomLines, currencyRates = {}) {
  console.log('\n🔍 Processing BOM Lines...');

  // Dynamic rate resolver: PLM extended fields önce, sonra hardcoded fallback
  const getRate = (currencyId) => {
    if (currencyRates[currencyId] !== undefined) return currencyRates[currencyId];
    return getCurrencyRate(currencyId); // fallback to hardcoded
  };

  const result = {};
  const allDefinedPlacements = getAllDefinedPlacements();
  
  // Collections for different material types
  const anaKumasItems = [];
  const astarItems = [];
  const garni1Items = [];
  const garni2Items = [];
  const garni3Items = [];
  const nakisItems = [];
  const kemerItems = [];
  const digerItems = [];

  // Categorize BOM lines by placement
  for (const line of bomLines) {
    if (!line.placement2) {
      console.log(`   ⚠️  Line ${line.code} has no Placement2, skipping`);
      continue;
    }

    const placements = line.placement2.split(',').map(p => parseInt(p.trim()));
    const firstPlacement = placements[0]; // Take first if multiple
    
    console.log(`   📌 Line: ${line.code} (${line.name}) - Placement: ${firstPlacement}, Qty: ${line.quantity}, Price: ${line.purchasePrice}, Currency: ${line.currencyId}`);

    // Categorize by placement
    if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.ANA_KUMAS.placements)) {
      anaKumasItems.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.ASTAR.placements)) {
      astarItems.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.GARNI_1.placements)) {
      garni1Items.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.GARNI_2.placements)) {
      garni2Items.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.GARNI_3.placements)) {
      garni3Items.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.NAKIS.placements)) {
      nakisItems.push(line);
    } else if (isPlacementInCategory(line.placement2, PLACEMENT_MAPPINGS.KEMER.placements)) {
      kemerItems.push(line);
    } else {
      // Check if it's a defined placement or truly "other"
      if (!allDefinedPlacements.includes(firstPlacement)) {
        digerItems.push(line);
      }
    }
  }

  console.log(`\n📊 Categorized BOM Lines:`);
  console.log(`   Ana Kumaş: ${anaKumasItems.length}`);
  console.log(`   Astar: ${astarItems.length}`);
  console.log(`   Garni 1: ${garni1Items.length}`);
  console.log(`   Garni 2: ${garni2Items.length}`);
  console.log(`   Garni 3: ${garni3Items.length}`);
  console.log(`   Nakış: ${nakisItems.length}`);
  console.log(`   Kemer: ${kemerItems.length}`);
  console.log(`   Diğer: ${digerItems.length}`);

  // Process Ana Kumaş (single item)
  if (anaKumasItems.length > 0) {
    const item = anaKumasItems[0]; // Take first if multiple
    result['KPRC'] = item.purchasePrice;
    result['KSARF'] = item.quantity;
    result['KKUR'] = getRate(item.currencyId);
    console.log(`✅ Ana Kumaş: KPRC=${item.purchasePrice}, KSARF=${item.quantity}, KKUR=${result['KKUR']}`);
  }

  // Process Astar (weighted average)
  if (astarItems.length > 0) {
    const normalized = normalizeItemsToCurrency(astarItems, 3, getRate);
    const weighted = calculateWeightedAverage(normalized);
    result['APRC'] = weighted.averagePrice;
    result['ASARF'] = weighted.totalQuantity;
    result['AKUR'] = getRate(3);
    console.log(`✅ Astar: APRC=${weighted.averagePrice.toFixed(2)}, ASARF=${weighted.totalQuantity.toFixed(2)}, AKUR=${result['AKUR']}`);
  }

  // Process Garni 1 (single item)
  if (garni1Items.length > 0) {
    const item = garni1Items[0];
    result['G1PRC'] = item.purchasePrice;
    result['G1SARF'] = item.quantity;
    result['G1KUR'] = getRate(item.currencyId);
    console.log(`✅ Garni 1: G1PRC=${item.purchasePrice}, G1SARF=${item.quantity}, G1KUR=${result['G1KUR']}`);
  }

  // Process Garni 2 (single item)
  if (garni2Items.length > 0) {
    const item = garni2Items[0];
    result['G2PRC'] = item.purchasePrice;
    result['G2SARF'] = item.quantity;
    result['G2KUR'] = getRate(item.currencyId);
    console.log(`✅ Garni 2: G2PRC=${item.purchasePrice}, G2SARF=${item.quantity}, G2KUR=${result['G2KUR']}`);
  }

  // Process Garni 3 (weighted average)
  if (garni3Items.length > 0) {
    const normalized = normalizeItemsToCurrency(garni3Items, 3, getRate);
    const weighted = calculateWeightedAverage(normalized);
    result['G3PRC'] = weighted.averagePrice;
    result['G3SARF'] = weighted.totalQuantity;
    result['G3KUR'] = getRate(3);
    console.log(`✅ Garni 3: G3PRC=${weighted.averagePrice.toFixed(2)}, G3SARF=${weighted.totalQuantity.toFixed(2)}, G3KUR=${result['G3KUR']}`);
  }

  // Process Nakış (price * quantity total, normalized to Currency 3)
  if (nakisItems.length > 0) {
    const normalized = normalizeItemsToCurrency(nakisItems, 3, getRate);
    const total = normalized.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
    result['IPRC'] = total;
    result['IKUR'] = getRate(3);
    console.log(`✅ Nakış: IPRC=${total.toFixed(2)}, IKUR=${result['IKUR']}`);
  }

  // Process Kemer (price * quantity total, normalized to Currency 3)
  if (kemerItems.length > 0) {
    const normalized = normalizeItemsToCurrency(kemerItems, 3, getRate);
    const total = normalized.reduce((sum, item) => sum + (item.purchasePrice * item.quantity), 0);
    result['KEPRC'] = total;
    result['KEKUR'] = getRate(3);
    console.log(`✅ Kemer: KEPRC=${total.toFixed(2)}, KEKUR=${result['KEKUR']}`);
  }

  // Process Diğer Trims (convert everything to TRY - Currency 4)
  if (digerItems.length > 0) {
    let totalTRY = 0;
    for (const item of digerItems) {
      const rate = getRate(item.currencyId);
      const tryValue = item.purchasePrice * item.quantity * rate;
      totalTRY += tryValue;
      console.log(`   💰 ${item.code}: ${item.purchasePrice} × ${item.quantity} × ${rate} = ${tryValue.toFixed(2)} TRY`);
    }
    result['ATRM'] = totalTRY;
    console.log(`✅ Diğer Trims: ATRM=${totalTRY.toFixed(2)} TRY`);
  }

  return result;
}

/**
 * Normalize items to a target currency
 * @param {Array} items - Array of BOM line items
 * @param {number} targetCurrencyId - Target currency ID
 * @param {Function} getRate - Rate resolver function (dynamic or fallback)
 * @returns {Array} Array of items with prices normalized to target currency
 */
function normalizeItemsToCurrency(items, targetCurrencyId, getRate = getCurrencyRate) {
  const targetRate = getRate(targetCurrencyId);
  
  return items.map(item => {
    const currentRate = getRate(item.currencyId);
    const normalizedPrice = (item.purchasePrice * currentRate) / targetRate;
    
    return {
      ...item,
      purchasePrice: normalizedPrice,
      currencyId: targetCurrencyId
    };
  });
}

/**
 * Calculate weighted average price and total quantity
 * @param {Array} items - Array of BOM line items (should be normalized to same currency)
 * @returns {Object} Object with averagePrice and totalQuantity
 */
function calculateWeightedAverage(items) {
  let totalQuantity = 0;
  let weightedSum = 0;

  for (const item of items) {
    totalQuantity += item.quantity;
    weightedSum += item.purchasePrice * item.quantity;
  }

  const averagePrice = totalQuantity > 0 ? weightedSum / totalQuantity : 0;

  return {
    averagePrice,
    totalQuantity
  };
}

module.exports = {
  processBomToCosting
};

