const express = require('express');
const router = express.Router();
const xmlParser = require('../utils/xmlParser');
const plmService = require('../services/plmService');
const costingCalculationService = require('../services/costingCalculationService');
const bomCalculationService = require('../services/bomCalculationService');
const plmPatchService = require('../services/plmPatchService');

/**
 * Main workflow processor endpoint
 * Receives XML, determines workflow type, and routes accordingly
 * POST /api/workflow/process
 */
router.post('/process', async (req, res) => {
  try {
    const requestData = req.body;
    
    if (!requestData) {
      return res.status(200).json({ 
        success: false,
        errorCode: 'NO_DATA',
        error: 'No data received',
        message: 'Request body is empty',
        timestamp: new Date().toISOString()
      });
    }

    console.log('\n🔄 ====== New Workflow Request ======');

    let workflowData;
    
    // Check if request is JSON or XML
    if (typeof requestData === 'object') {
      // JSON format from ION: { workflowdefination: "UPDATED_...", moduleId: "158", decisionTableValues: {...} }
      console.log('📦 Input format: JSON');
      workflowData = {
        moduleId: requestData.moduleId,
        workflowDefinitionCode: requestData.workflowdefination || requestData.workflowDefinitionCode,
        decisionTableValues: requestData.decisionTableValues || null  // New: Decision table values from ION
      };
    } else if (typeof requestData === 'string') {
      // XML format (legacy support)
      console.log('📦 Input format: XML');
      workflowData = await xmlParser.extractWorkflowData(requestData);
    } else {
      return res.status(200).json({ 
        success: false,
        errorCode: 'INVALID_FORMAT',
        error: 'Invalid request format',
        message: 'Request must be JSON or XML',
        timestamp: new Date().toISOString()
      });
    }
    
    if (!workflowData.moduleId) {
      return res.status(200).json({ 
        success: false,
        errorCode: 'MODULE_ID_NOT_FOUND',
        error: 'ModuleId not found',
        message: 'ModuleId property not found in the request',
        timestamp: new Date().toISOString()
      });
    }

    if (!workflowData.workflowDefinitionCode) {
      return res.status(200).json({ 
        success: false,
        errorCode: 'WORKFLOW_CODE_NOT_FOUND',
        error: 'WorkflowDefinitionCode not found',
        message: 'WorkflowDefinitionCode not found in the request',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`📋 ModuleId: ${workflowData.moduleId}`);
    console.log(`📋 WorkflowDefinitionCode: ${workflowData.workflowDefinitionCode}`);

    // Route based on WorkflowDefinitionCode
    switch (workflowData.workflowDefinitionCode) {
      case 'UPDATED_STYLE_OVERVIEW':
        return await handleOverviewToCosting(workflowData.moduleId, workflowData.decisionTableValues, res);
      
      case 'UPDATED_STYLE_BOO':
        return await handleBooToCosting(workflowData.moduleId, res);
      
      case 'UPDATED_STYLE_BOM':
        return await handleBomToCosting(workflowData.moduleId, res);
      
      default:
        console.log(`⚠️  Unknown workflow type: ${workflowData.workflowDefinitionCode}`);
        return res.status(200).json({
          success: true,
          message: 'Workflow received but route not found',
          workflowType: workflowData.workflowDefinitionCode,
          moduleId: workflowData.moduleId,
          timestamp: new Date().toISOString()
        });
    }

  } catch (error) {
    console.error('❌ Error processing workflow:', error);
    // ALWAYS return 200, with error details in response
    res.status(200).json({ 
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Handle UPDATED_STYLE_OVERVIEW workflow
 * @param {string} moduleId - Style ID from input
 * @param {Object|null} decisionTableValues - Decision table values from ION (nullable)
 * @param {Object} res - Express response object
 */
async function handleOverviewToCosting(moduleId, decisionTableValues, res) {
  try {
    console.log('\n🎯 Route: OVERVIEW_TO_COSTING');
    console.log(`📥 Fetching style data for StyleId: ${moduleId}`);

    // 1. Get style costing data from PLM
    const rawStyleData = await plmService.getStyleCosting(moduleId);
    
    if (!rawStyleData) {
      return res.status(200).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: `No style data found for StyleId: ${moduleId}`,
        styleId: moduleId,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Style data retrieved from PLM');

    // Parse style data to camelCase format
    const styleData = plmService.parseStyleCostingData(rawStyleData);

    // 2. Process costing calculations
    console.log('🔢 Processing costing calculations...');
    const calculatedData = costingCalculationService.processStyleToSegmentPSF(styleData, decisionTableValues);
    
    console.log('✅ Costing calculations completed');

    // 3. PATCH data back to PLM
    console.log('💾 PATCH data back to PLM...');
    const patchResults = await plmPatchService.patchCostingData(calculatedData);
    
    console.log('✅ PATCH operations completed');

    // Return result - ALWAYS 200
    return res.status(200).json({
      success: true,
      workflow: 'OVERVIEW_TO_COSTING',
      styleId: moduleId,
      calculatedData: calculatedData,
      patchResults: patchResults,
      message: 'Costing calculation and PATCH completed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in handleOverviewToCosting:', error);
    // ALWAYS return 200, with error details
    return res.status(200).json({
      success: false,
      errorCode: 'OVERVIEW_TO_COSTING_ERROR',
      error: error.message,
      message: 'Error processing OVERVIEW_TO_COSTING workflow',
      styleId: moduleId,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle UPDATED_STYLE_BOO workflow
 * @param {string} moduleId - Style ID from XML
 * @param {Object} res - Express response object
 */
async function handleBooToCosting(moduleId, res) {
  try {
    console.log('\n🎯 Route: BOO_TO_COSTING');
    console.log(`📥 Fetching style BOO data for StyleId: ${moduleId}`);

    // 1. Get style BOO data from PLM
    const styleData = await plmService.getAndParseStyleBoo(moduleId);
    
    if (!styleData) {
      return res.status(200).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: `No style data found for StyleId: ${moduleId}`,
        styleId: moduleId,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Style BOO data retrieved from PLM');

    // 2. Process costing calculations with BOO data
    console.log('🔢 Processing costing calculations with BOO data...');
    const calculatedData = costingCalculationService.processBooToCosting(styleData);
    
    console.log('✅ Costing calculations completed');

    // 4. PATCH data back to PLM
    console.log('💾 PATCH data back to PLM...');
    const patchResults = await plmPatchService.patchCostingData(calculatedData);
    
    console.log('✅ PATCH operations completed');

    // Return result - ALWAYS 200
    return res.status(200).json({
      success: true,
      workflow: 'BOO_TO_COSTING',
      styleId: moduleId,
      booOperationsCount: styleData.boo?.operations?.length || 0,
      calculatedData: calculatedData,
      patchResults: patchResults,
      message: 'BOO costing calculation and PATCH completed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in handleBooToCosting:', error);
    // ALWAYS return 200, with error details
    return res.status(200).json({
      success: false,
      errorCode: 'BOO_TO_COSTING_ERROR',
      error: error.message,
      message: 'Error processing BOO_TO_COSTING workflow',
      styleId: moduleId,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle UPDATED_STYLE_BOM workflow
 * @param {string} moduleId - Style ID from XML
 * @param {Object} res - Express response object
 */
async function handleBomToCosting(moduleId, res) {
  try {
    console.log('\n🎯 Route: BOM_TO_COSTING');
    console.log(`📥 Fetching style BOM data for StyleId: ${moduleId}`);

    // 1. Get style BOM data from PLM
    const styleData = await plmService.getAndParseStyleBom(moduleId);
    
    if (!styleData) {
      return res.status(200).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: `No style data found for StyleId: ${moduleId}`,
        styleId: moduleId,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Style BOM data retrieved from PLM');

    // 2. Process costing calculations with BOM data
    console.log('🔢 Processing costing calculations with BOM data...');
    const calculatedData = bomCalculationService.processBomToCosting(styleData);
    
    console.log('✅ Costing calculations completed');

    // 3. PATCH data back to PLM
    console.log('💾 PATCH data back to PLM...');
    const patchResults = await plmPatchService.patchCostingData(calculatedData);
    
    console.log('✅ PATCH operations completed');

    // Return result - ALWAYS 200
    return res.status(200).json({
      success: true,
      workflow: 'BOM_TO_COSTING',
      styleId: moduleId,
      bomLinesCount: styleData.bom?.lines?.length || 0,
      calculatedData: calculatedData,
      patchResults: patchResults,
      message: 'BOM costing calculation and PATCH completed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in handleBomToCosting:', error);
    // ALWAYS return 200, with error details
    return res.status(200).json({
      success: false,
      errorCode: 'BOM_TO_COSTING_ERROR',
      error: error.message,
      message: 'Error processing BOM_TO_COSTING workflow',
      styleId: moduleId,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle UPDATED_STYLE_BOM workflow
 * @param {string} moduleId - Style ID from XML
 * @param {Object} res - Express response object
 */
async function handleBomToCosting(moduleId, res) {
  try {
    console.log('\n🎯 Route: BOM_TO_COSTING');
    console.log(`📥 Fetching style BOM data for StyleId: ${moduleId}`);

    // 1. Get style BOM data from PLM
    const styleData = await plmService.getAndParseStyleBom(moduleId);
    
    if (!styleData) {
      return res.status(200).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: `No style data found for StyleId: ${moduleId}`,
        styleId: moduleId,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Style BOM data retrieved from PLM');

    // 2. Process BOM costing calculations
    console.log('🔢 Processing BOM costing calculations...');
    const calculatedData = bomCalculationService.processBomToCosting(styleData);
    
    console.log('✅ BOM costing calculations completed');

    // 3. PATCH data back to PLM
    console.log('💾 PATCH data back to PLM...');
    const patchResults = await plmPatchService.patchCostingData(calculatedData);
    
    console.log('✅ PATCH operations completed');

    // Return result - ALWAYS 200
    return res.status(200).json({
      success: true,
      workflow: 'BOM_TO_COSTING',
      styleId: moduleId,
      bomLinesCount: styleData.bom?.bomLines?.length || 0,
      calculatedData: calculatedData,
      patchResults: patchResults,
      message: 'BOM costing calculation and PATCH completed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in handleBomToCosting:', error);
    // ALWAYS return 200, with error details
    return res.status(200).json({
      success: false,
      errorCode: 'BOM_TO_COSTING_ERROR',
      error: error.message,
      message: 'Error processing BOM_TO_COSTING workflow',
      styleId: moduleId,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Get cost element values endpoint
 * Retrieves specific cost element values from PLM for the main supplier
 * POST /api/workflow/get-cost-element-values
 * Body: { filter: "StyleId eq 10596" }
 */
router.post('/get-cost-element-values', async (req, res) => {
  try {
    const { filter } = req.body;
    
    if (!filter) {
      return res.status(400).json({ 
        success: false,
        errorCode: 'MISSING_FILTER',
        error: 'Filter is required',
        message: 'Please provide a filter parameter (e.g., "StyleId eq 10596")',
        timestamp: new Date().toISOString()
      });
    }

    console.log('\n🔍 ====== Get Cost Element Values Request ======');
    console.log(`📋 Filter: ${filter}`);

    // Construct OData query with StyleExtendedFieldValues
    const costingExpand = 'STYLECOSTING($expand=STYLECOSTELEMENTS($select=Id,StyleCostingId,Code;$expand=STYLECOSTINGSUPPLIERVALS;$filter=Code eq \'GKUR\' or Code eq \'TKMS\' or Code eq \'TAST\' or Code eq \'TISC\' or Code eq \'TTRM\' or Code eq \'TISL\' or Code eq \'TDGR\' or Code eq \'TCOST\' or Code eq \'MCOST\' or Code eq \'RMU\' or Code eq \'KPRC\' or Code eq \'KKUR\'),STYLECOSTSUPPLIERS($select=Id,StyleCostingId,StyleSupplierId,IsActive,IsLock,IsMainVersion);$select=Id,CostModelId,CurrencyId)';
    const extendedFieldsExpand = 'STYLEEXTENDEDFIELDVALUES($select=StyleId,Id,ExtFldId,NumberValue;$expand=STYLEEXTENDEDFIELDS($select=Name))';
    const odataQuery = `$select=StyleId,StyleCode&$expand=${costingExpand},${extendedFieldsExpand}&$filter=${filter}`;

    console.log('🌐 Fetching data from PLM...');
    
    // Fetch data from PLM
    const response = await plmService.getStyleData(odataQuery);

    if (!response || !response.value || response.value.length === 0) {
      return res.status(404).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: 'No style found matching the provided filter',
        filter: filter,
        timestamp: new Date().toISOString()
      });
    }

    const styleData = response.value[0];
    console.log(`✅ Style found: ${styleData.StyleCode} (ID: ${styleData.StyleId})`);

    if (!styleData.StyleCosting || styleData.StyleCosting.length === 0) {
      return res.status(404).json({
        success: false,
        errorCode: 'NO_COSTING_DATA',
        error: 'No costing data found for this style',
        message: 'Style exists but has no costing data',
        styleId: styleData.StyleId,
        timestamp: new Date().toISOString()
      });
    }

    const costing = styleData.StyleCosting[0];
    const suppliers = costing.StyleCostSuppliers || [];
    const costElements = costing.StyleCostElements || [];

    console.log(`📊 Total Suppliers: ${suppliers.length}`);
    console.log(`📊 Total Cost Elements: ${costElements.length}`);

    // Filter suppliers: IsMainVersion=true AND IsActive=true
    const mainActiveSuppliers = suppliers.filter(s => 
      s.IsMainVersion === true && s.IsActive === true
    );

    console.log(`✅ Main + Active Suppliers: ${mainActiveSuppliers.length}`);

    if (mainActiveSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        errorCode: 'NO_MAIN_SUPPLIER',
        error: 'No main active supplier found',
        message: 'No supplier with IsMainVersion=true and IsActive=true',
        styleId: styleData.StyleId,
        timestamp: new Date().toISOString()
      });
    }

    // Find the supplier with the highest Id
    const selectedSupplier = mainActiveSuppliers.reduce((max, current) => 
      current.Id > max.Id ? current : max
    );

    console.log(`🎯 Selected Supplier: Id=${selectedSupplier.Id}, StyleSupplierId=${selectedSupplier.StyleSupplierId}`);

    // Extract values for each cost element
    const result = {};
    const targetCodes = ['GKUR', 'TKMS', 'TAST', 'TISC', 'TTRM', 'TISL', 'TDGR', 'TCOST', 'MCOST', 'RMU', 'KPRC', 'KKUR'];

    for (const code of targetCodes) {
      const element = costElements.find(e => e.Code === code);
      
      if (!element) {
        console.warn(`⚠️  Cost Element '${code}' not found`);
        result[code] = null;
        continue;
      }

      const supplierVal = element.StyleCostingSupplierVals?.find(
        sv => sv.StyleCostingSupplierId === selectedSupplier.Id
      );

      if (!supplierVal) {
        console.warn(`⚠️  No supplier value found for '${code}' and Supplier Id=${selectedSupplier.Id}`);
        result[code] = null;
      } else {
        result[code] = supplierVal.Value;
        console.log(`✅ ${code}: ${supplierVal.Value}`);
      }
    }

    console.log('✅ Cost element values extracted successfully');

    // Extract Extended Field Values
    console.log('\n📋 Extracting Extended Field Values...');
    const extendedFields = styleData.StyleExtendedFieldValues || [];
    console.log(`📊 Total Extended Fields: ${extendedFields.length}`);

    // Build extended fields object with fieldName as key and id as value
    const extendedFieldsData = {};
    for (const field of extendedFields) {
      const fieldName = field.StyleExtendedFields?.Name;
      if (fieldName) {
        extendedFieldsData[fieldName] = field.Id;
        console.log(`✅ ${fieldName}: Id=${field.Id}`);
      }
    }

    console.log(`✅ Extracted ${Object.keys(extendedFieldsData).length} extended fields`);

    return res.status(200).json({
      success: true,
      styleId: styleData.StyleId,
      styleCode: styleData.StyleCode,
      selectedSupplierId: selectedSupplier.Id,
      values: result,
      extendedFieldIds: extendedFieldsData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in get-cost-element-values:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      error: error.message,
      message: 'Error retrieving cost element values',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Calculate and update Cost5, Cost8, Cost9 for a style
 * POST /api/workflow/calculate-cost-fields
 * Body: { styleId: "11457" }
 */
router.post('/calculate-cost-fields', async (req, res) => {
  try {
    const { styleId } = req.body;
    
    if (!styleId) {
      return res.status(400).json({ 
        success: false,
        errorCode: 'MISSING_STYLE_ID',
        error: 'StyleId is required',
        message: 'Please provide a styleId parameter',
        timestamp: new Date().toISOString()
      });
    }

    console.log('\n🧮 ====== Calculate Cost Fields Request ======');
    console.log(`📋 StyleId: ${styleId}`);

    // Build OData query to get required fields
    const extendedFieldsExpand = 'STYLEEXTENDEDFIELDVALUES($select=StyleId,Id,ExtFldId,NumberValue,CheckboxValue,DropdownValues;$orderby=ExtFldId;$expand=STYLEEXTENDEDFIELDS($select=Name))';
    const odataQuery = `$select=StyleId,StyleCode,BrandId,Quantity,NumericValue1,DeliveryIdList&$filter=styleid eq ${styleId}&$expand=${extendedFieldsExpand}`;

    console.log('🌐 Fetching data from PLM...');
    
    // Fetch data from PLM
    const response = await plmService.getStyleData(odataQuery);

    if (!response || !response.value || response.value.length === 0) {
      return res.status(404).json({
        success: false,
        errorCode: 'STYLE_NOT_FOUND',
        error: 'Style not found',
        message: 'No style found with the provided StyleId',
        styleId: styleId,
        timestamp: new Date().toISOString()
      });
    }

    const styleData = response.value[0];
    console.log(`✅ Style found: ${styleData.StyleCode} (BrandId: ${styleData.BrandId})`);

    const brandId = styleData.BrandId;
    const numericValue1 = styleData.NumericValue1 || 0;
    const quantity = styleData.Quantity || 0;
    const deliveryIdList = styleData.DeliveryIdList || '';

    console.log(`📊 BrandId: ${brandId}, NumericValue1: ${numericValue1}, Quantity: ${quantity}`);
    console.log(`📦 DeliveryIdList: ${deliveryIdList}`);

    // Extract extended field values by name
    const extendedFields = styleData.StyleExtendedFieldValues || [];
    const fieldMap = {};
    
    for (const field of extendedFields) {
      const fieldName = field.StyleExtendedFields?.Name;
      if (fieldName) {
        // Parse NumberValue - handle null, empty string, or actual number
        let numValue = 0;
        if (field.NumberValue !== null && field.NumberValue !== undefined && field.NumberValue !== '') {
          numValue = parseFloat(field.NumberValue) || 0;
        }
        
        // Parse DropdownValues - handle null, empty string, or actual value
        let dropdownValue = null;
        if (field.DropdownValues !== null && field.DropdownValues !== undefined && field.DropdownValues !== '') {
          dropdownValue = parseInt(field.DropdownValues) || null;
        }
        
        fieldMap[fieldName] = {
          id: field.Id,
          extFldId: field.ExtFldId,
          value: numValue,
          dropdownValue: dropdownValue,
          checkBoxValue: field.CheckboxValue || false  // Note: lowercase 'b' in API
        };
      }
    }

    // Required fields
    const requiredFields = ['Alım Fiyatı_TRY', 'Cost4', 'Cost5', 'Cost6', 'Cost7', 'Cost8', 'Cost9', 'Cost10', 'SelectYD', 'SelectUretim', 'SelectLocal', 'TCOST', 'Cur2', 'Cur3', 'Cur4'];
    
    // Check if all required fields exist
    const missingFields = requiredFields.filter(f => !fieldMap[f]);
    if (missingFields.length > 0) {
      console.warn(`⚠️  Missing fields: ${missingFields.join(', ')}`);
    }

    // Extract values
    const alimFiyatTRY = fieldMap['Alım Fiyatı_TRY']?.value || 0;
    const cost4 = fieldMap['Cost4']?.value || 0;
    const cost6 = fieldMap['Cost6']?.value || 0;
    const cost7 = fieldMap['Cost7']?.value || 0;
    const cost10 = fieldMap['Cost10']?.value || 55; // Default exchange rate
    const tcost = fieldMap['TCOST']?.value || 0;
    let selectYD = fieldMap['SelectYD']?.checkBoxValue || false;
    let selectUretim = fieldMap['SelectUretim']?.checkBoxValue || false;
    let selectLocal = fieldMap['SelectLocal']?.checkBoxValue || false;
    
    // Currency dropdown values (for conversion check)
    const cur2 = fieldMap['Cur2']?.dropdownValue || null;  // Cost4's currency
    const cur3 = fieldMap['Cur3']?.dropdownValue || null;  // Cost6's currency
    const cur4 = fieldMap['Cur4']?.dropdownValue || null;  // Cost7's currency

    console.log('\n📋 Input Values:');
    console.log(`   Alım Fiyatı_TRY: ${alimFiyatTRY}`);
    console.log(`   Cost4: ${cost4}`);
    console.log(`   Cost6: ${cost6}`);
    console.log(`   Cost7: ${cost7}`);
    console.log(`   Cost10: ${cost10}`);
    console.log(`   TCOST: ${tcost}`);
    console.log(`   SelectYD: ${selectYD}`);
    console.log(`   SelectUretim: ${selectUretim}`);
    console.log(`   SelectLocal: ${selectLocal}`);
    console.log(`   Cur2 (Cost4 currency): ${cur2}`);
    console.log(`   Cur3 (Cost6 currency): ${cur3}`);
    console.log(`   Cur4 (Cost7 currency): ${cur4}`);

    // ========== CALCULATION LOGIC ==========
    
    // Determine which currency to check based on selected option
    let activeCurrency = null;
    let activeCurrencyName = '';
    
    if (selectYD) {
      activeCurrency = cur2;  // Cost4's currency
      activeCurrencyName = 'Cur2 (Cost4)';
    } else if (selectLocal) {
      activeCurrency = cur3;  // Cost6's currency
      activeCurrencyName = 'Cur3 (Cost6)';
    } else if (selectUretim) {
      activeCurrency = cur4;  // Cost7's currency
      activeCurrencyName = 'Cur4 (Cost7)';
    }
    
    // Check if currency conversion is needed (active currency = 840, 842, 844, 846)
    const currencyConversionCodes = [840, 842, 844, 846];
    const needsCurrencyConversion = activeCurrency && currencyConversionCodes.includes(activeCurrency);
    
    console.log(`\n💱 Currency Conversion Check:`);
    console.log(`   Active currency: ${activeCurrencyName} = ${activeCurrency}`);
    console.log(`   Needs conversion: ${needsCurrencyConversion}`);
    if (needsCurrencyConversion) {
      console.log(`   Exchange rate (Cost10): ${cost10}`);
    }
    
    // DeliveryIdList logic: If all checkboxes are false, check DeliveryIdList
    if (!selectYD && !selectUretim && !selectLocal) {
      console.log(`\n📦 All checkboxes are false, checking DeliveryIdList...`);
      
      // Parse DeliveryIdList (comma-separated string)
      const deliveryIds = deliveryIdList
        .split(',')
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      console.log(`   DeliveryIds: [${deliveryIds.join(', ')}]`);
      
      if (deliveryIds.length === 1) {
        const deliveryId = deliveryIds[0];
        console.log(`   Single delivery found: ${deliveryId}`);
        
        if (deliveryId === '1') {
          selectLocal = true;
          activeCurrency = cur3;  // Cost6's currency
          activeCurrencyName = 'Cur3 (Cost6)';
          console.log(`   ✅ DeliveryId=1 → SelectLocal=true, checking Cur3`);
        } else if (deliveryId === '2') {
          selectUretim = true;
          activeCurrency = cur4;  // Cost7's currency
          activeCurrencyName = 'Cur4 (Cost7)';
          console.log(`   ✅ DeliveryId=2 → SelectUretim=true, checking Cur4`);
        } else if (deliveryId === '4') {
          selectYD = true;
          activeCurrency = cur2;  // Cost4's currency
          activeCurrencyName = 'Cur2 (Cost4)';
          console.log(`   ✅ DeliveryId=4 → SelectYD=true, checking Cur2`);
        } else {
          console.log(`   ⚠️  Unknown DeliveryId: ${deliveryId}`);
        }
        
        // Re-check currency conversion after DeliveryIdList logic
        const needsConversion = activeCurrency && currencyConversionCodes.includes(activeCurrency);
        console.log(`   Currency conversion needed: ${needsConversion} (${activeCurrencyName} = ${activeCurrency})`);
      } else {
        console.log(`   ⚠️  Multiple or no deliveries found, no checkbox override`);
      }
    }
    
    let cost5 = 0;
    
    // 1. Calculate Cost5
    if (selectYD === true) {
      // Cost5 = Cost4 * brandMultiplier * 1.1
      let brandMultiplier = 1;
      if (brandId === 4) {
        brandMultiplier = 1.38;
      } else if (brandId === 8) {
        brandMultiplier = 1.51;
      }
      cost5 = cost4 * brandMultiplier * 1.1;
      console.log(`\n✅ Cost5 (SelectYD=true): ${cost4} * ${brandMultiplier} * 1.1 = ${cost5}`);
    } else if (selectLocal === true) {
      // Cost5 = Cost6
      cost5 = cost6;
      console.log(`\n✅ Cost5 (SelectLocal=true): ${cost5} (from Cost6)`);
    } else if (selectUretim === true) {
      // Cost5 = Cost7
      cost5 = cost7;
      console.log(`\n✅ Cost5 (SelectUretim=true): ${cost5} (from Cost7)`);
    } else {
      console.log(`\n⚠️  No condition met for Cost5 calculation, remains 0`);
    }

    // Convert Cost5 to TRY if active currency requires conversion and Cost5 is in USD (< 100)
    // Re-calculate needsCurrencyConversion with final active currency
    const finalNeedsCurrencyConversion = activeCurrency && currencyConversionCodes.includes(activeCurrency);
    
    if (finalNeedsCurrencyConversion && cost5 > 0 && cost5 < 100) {
      const originalCost5 = cost5;
      cost5 = cost5 * cost10;
      console.log(`💱 Cost5 converted to TRY: ${originalCost5} USD × ${cost10} (from ${activeCurrencyName}) = ${cost5} TRY`);
    } else if (cost5 > 0 && cost5 < 100) {
      console.log(`⚠️  Cost5 < 100 but currency conversion NOT needed (${activeCurrencyName} = ${activeCurrency})`);
    }

    // Determine multiplier: Quantity if > 0, otherwise NumericValue1
    let cost8 = 0;
    let cost9 = 0;
    
    if (quantity && quantity > 0) {
      // Use Quantity for both calculations
      console.log(`\n📊 Using Quantity (${quantity}) for calculations`);
      cost9 = (alimFiyatTRY - cost5) * quantity;
      cost8 = (alimFiyatTRY - tcost) * quantity;
      console.log(`✅ Cost9: (${alimFiyatTRY} - ${cost5}) * ${quantity} = ${cost9}`);
      console.log(`✅ Cost8: (${alimFiyatTRY} - ${tcost}) * ${quantity} = ${cost8}`);
    } else {
      // Use NumericValue1 for Cost9 only
      console.log(`\n📊 Quantity is 0 or null, using NumericValue1 (${numericValue1}) for Cost9`);
      cost9 = (alimFiyatTRY - cost5) * numericValue1;
      cost8 = 0; // Cost8 not calculated when Quantity is 0
      console.log(`✅ Cost9: (${alimFiyatTRY} - ${cost5}) * ${numericValue1} = ${cost9}`);
      console.log(`⚠️  Cost8: Not calculated (Quantity is 0 or null)`);
    }

    // ========== PATCH TO PLM ==========
    
    console.log('\n💾 Patching calculated values to PLM...');
    
    const patchData = [];
    
    if (fieldMap['Cost5']) {
      patchData.push({
        Id: fieldMap['Cost5'].id,
        NumberValue: cost5
      });
    }
    
    if (fieldMap['Cost8']) {
      patchData.push({
        Id: fieldMap['Cost8'].id,
        NumberValue: cost8
      });
    }
    
    if (fieldMap['Cost9']) {
      patchData.push({
        Id: fieldMap['Cost9'].id,
        NumberValue: cost9
      });
    }

    console.log(`📤 Patching ${patchData.length} fields...`);
    
    const plmPatchService = require('../services/plmPatchService');
    const patchResults = await plmPatchService.patchExtendedFields(patchData);

    console.log('✅ PATCH completed successfully');

    return res.status(200).json({
      success: true,
      styleId: styleId,
      styleCode: styleData.StyleCode,
      inputs: {
        brandId: brandId,
        numericValue1: numericValue1,
        quantity: quantity,
        alimFiyatTRY: alimFiyatTRY,
        cost4: cost4,
        cost6: cost6,
        cost7: cost7,
        tcost: tcost,
        selectYD: selectYD,
        selectUretim: selectUretim,
        selectLocal: selectLocal
      },
      calculated: {
        cost5: cost5,
        cost8: cost8,
        cost9: cost9
      },
      patchResults: patchResults,
      message: 'Cost fields calculated and patched successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in calculate-cost-fields:', error);
    return res.status(500).json({
      success: false,
      errorCode: 'CALCULATION_ERROR',
      error: error.message,
      message: 'Error calculating cost fields',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

